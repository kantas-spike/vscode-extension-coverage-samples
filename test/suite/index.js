const path = require('path');
const Mocha = require('mocha');
const glob = require('glob');
const { createInstrumenter } = require('istanbul-lib-instrument');
const instrumenter = createInstrumenter();
const { hookRequire } = require('istanbul-lib-hook');
const TestExclude = require('test-exclude')
var libCoverage = require('istanbul-lib-coverage');

function setupCoverage(testsRoot) {
	const projectRoot = path.resolve(path.join(testsRoot, ".."))
	console.log("project: ", projectRoot)
	const matcher = new TestExclude({ cwd: projectRoot,  exclude: [".vscode/extensions/**", "node_modules/**", "test/**", "coverage/**"], extension: ['.js'] })
	hookRequire((filePath) => {
		const r = matcher.shouldInstrument(filePath)
		// console.log(filePath, r)
		return r
	}, (code, { filename }) => instrumenter.instrumentSync(code, filename));
}

function reportCoverage(testsRoot) {
  const projectRoot = path.resolve(path.join(testsRoot, ".."))
  console.log("dir:", projectRoot)
  var coverageMap = libCoverage.createCoverageMap(global.__coverage__);

  const libReport = require("istanbul-lib-report");
  const reports = require("istanbul-reports");

    // create a context for report generation
  const context = libReport.createContext({ dir: path.join(projectRoot, "coverage"), coverageMap });

    // create an instance of the relevant report class, passing the
  // report name e.g. json/html/html-spa/text
  const report = reports.create("html");
// call execute to synchronously create and write the report to disk
  report.execute(context);
}

function run() {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, '..');
	setupCoverage(testsRoot)

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
				console.log("END!!")
				reportCoverage(testsRoot)
			} catch (err) {
				console.error(err);
				e(err);
			}
		});
	});
}

module.exports = {
	run
};
