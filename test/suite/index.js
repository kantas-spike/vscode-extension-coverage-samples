const path = require('path');
const Mocha = require('mocha');
const glob = require('glob');

const fs = require("fs")
const istanbul = require("istanbul")
const remapIstanbul = require("remap-istanbul")

function _mkDirUnlessExists(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir)
	}
}

function _readCoverOptions(testsRoot) {
	const coverConfigPath = path.join(testsRoot, "..", "coverconfig.json")
	// console.log(coverConfigPath)
	if (fs.existsSync(coverConfigPath)) {
		const configContent = fs.readFileSync(coverConfigPath, 'utf-8')
		return JSON.parse(configContent)
	}
	return undefined
}


function run() {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});


	const testsRoot = path.resolve(__dirname, '..');
	const coverOptions = _readCoverOptions(testsRoot)
	// console.log(coverOptions)
	if (coverOptions && coverOptions.enabled) {
		// setup coverage pre-test, including post-test hook to repot
		const coverageRunner = new CoverageRunner(coverOptions, testsRoot)
		coverageRunner.setupCoverage()
	}

	return new Promise((c, e) => {
		const testFiles = new glob.Glob('**/**.test.js', { cwd: testsRoot });
		const testFileStream = testFiles.stream();

		testFileStream.on('data', (file) => {
			// Add files to the test suite
			mocha.addFile(path.resolve(testsRoot, file));
		});
		testFileStream.on('error', (err) => {
			e(err);
		});
		testFileStream.on('end', () => {
			try {
				// Run the mocha test
				mocha.run(failures => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				console.error(err);
				e(err);
			}
		});
	});
}

class CoverageRunner {
	constructor(options, testsRoot){
		this.coverageVar = "$$cov_" + new Date().getTime() + "$$"
		this.testsRoot = testsRoot
		this.options = options
		if (!options.relativeSourcePath) {
			return;
		}
	}

	setupCoverage() {
		// set up code coverage, hooking require so that instrumented code is returned
		const self = this
		self.instrumenter = new istanbul.Instrumenter({ coverageVariable: self.coverageVar })
		const sourceRoot = path.join(self.testsRoot, self.options.relativeSourcePath)

		// glob source files
		const srcFiles = glob.sync("**/**.js", {
			cwd: sourceRoot,
			ignore: self.options.ignorePatterns,
		})

		// create a match function - taken from the run-with-conver.js in istanbul.
		const decache = require('decache');
		const fileMap = {}
		srcFiles.forEach((file) => {
			const fullPath = path.join(sourceRoot, file)
			fileMap[fullPath] = true
			// On windows, extension is loaded pre test hooks and this mean we lose
			// our chance to hook the require call.
			// In order to instrument the code we have to decache the JS file so on next load it gets instrumented.
			// This doesn't impact test, but is a concern if we had some integration tests that relied on VSCode accessing our module
			// since there could be some shared global state that we lose.
			decache(fullPath)
		})

		self.matchFn = (file) => fileMap[file]
		self.matchFn.files = Object.keys(fileMap)

		// Hook up to the Require function so that when this is called, if any of our source files
		// are required, the instrumented version is pulled in instead. These instrumented versions
		// write to a global coverage variable with hit counts whenever they are accessed
		self.transformer = self.instrumenter.instrumentSync.bind(self.instrumenter)
		const hookOpts = { verbose: false, extensions: ['.js']}
		istanbul.hook.hookRequire(self.matchFn, self.transformer, hookOpts)

		// initialize the global variable to stop mocha from complaining about leaks
		global[self.coverageVar] = {}

		// hook the process exit event to handle repoting
		// Only report coverage if the process is existing successfully
		process.on('exit', (code) => {
			self.reportCoverage()
			process.exitCode = code
		})
	}

	reportCoverage() {
		const self = this
		istanbul.hook.unhookRequire()
		let cov
		if (typeof global[self.coverageVar] === 'undefined' || Object.keys(global[self.coverageVar]).length === 0) {
			console.error('No coverage information was collected, exit without writing converage information')
			return
		} else {
			cov = global[self.coverageVar]
		}

		// TODO consider putting this under a conditional flag
		// Files that are not touched by code ran by the test runner is mannually instrumented, to illustrate the missing coverage
		self.matchFn.files.forEach((file) => {
			if (cov[file]) {
				return
			}
			self.transformer(fs.readFileSync(file, 'utf-8'), file)

			// when instrumenting the code, istanbul will give each FunctionDeclaration a value of 1 in coverState.s,
			// presumably to compensate for function hoisting. We need to reset this, as the function was not hoisted, as it was never loaded.
			Object.keys(self.instrumenter.coverState.s).forEach(key => {
				self.instrumenter.coverState.s[key] = 0
			})
			cov[file] = self.instrumenter.coverState
		})

		// TODO Allow config of reporting directory with
		const reportingDir = path.join(self.testsRoot, self.options.relativeCoverageDir);
		const includePid = self.options.includePid;
		const pidExt = includePid ? ('-' + process.pid) : '';
		const coverageFile = path.resolve(reportingDir, 'coverage' + pidExt + '.json');

		// yes, do this again since some test runners could clean the dir initially created
		_mkDirUnlessExists(reportingDir);

		fs.writeFileSync(coverageFile, JSON.stringify(cov), 'utf-8');

		const remappedCollector = remapIstanbul.remap(cov, {
			warn: (warning) => {
				// We expect some warnings as any JS file without a typescript mapping will cause this.
        		// By default, we'll skip printing these to the console as it clutters it up
				if (self.options.verbose) {
					console.warn(warning)
				}
			}
		})

		const reporter = new istanbul.Reporter(undefined, reportingDir)
		const reportTypes = (self.options.reports instanceof Array) ? self.options.reports : ['lcov']
		reporter.addAll(reportTypes)
		reporter.write(remappedCollector, true, () => {
			console.log(`reports written to ${reportingDir}`)
		})
	}
}

module.exports = {
	run
};
