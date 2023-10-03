const path = require('path');
const fs = require('fs');

const { createInstrumenter } = require('istanbul-lib-instrument');
const coverageVar = '$$cov_' + new Date().getTime() + '$$';
const instrumenter = createInstrumenter({
	coverageVariable: coverageVar
  })
const { hookRequire } = require('istanbul-lib-hook');
var libCoverage = require('istanbul-lib-coverage');

function setupCoverage(projectRoot) {
	console.log("projectRoot: ", projectRoot)
	const config = readConfig(projectRoot)
	// console.log("config: ", config)
	const TestExclude = require('test-exclude')
	const matchOption = Object.keys(config).filter(k => ['cwd', 'extension', 'include', 'exclude']).reduce((obj, k) => {
		obj[k] = config[k]
		return obj
	}, {})
	// console.log("matchOption: ", matchOption)

	const matcher = new TestExclude({ ...matchOption })
	console.log("\nmatcher:\n    ", JSON.stringify(matcher))
	console.log("\nmatched: ")
	hookRequire((filePath) => {
		const r = matcher.shouldInstrument(filePath)
		if (r) {
			console.log("   ", filePath)
		}
		return r
	}, (code, { filename }) => instrumenter.instrumentSync(code, filename));
	global[coverageVar] = {}

	process.on('exit', () => {
		reportCoverage(projectRoot, config)
	})
}

function readConfig(projectRoot) {
	console.log("readConfig: ")
	const configPath = path.join(projectRoot, "coverage.config.json")
	if (fs.existsSync(configPath)) {
		const config =  JSON.parse(fs.readFileSync(configPath, 'utf-8'))
		if (config["cwd"]) {
			if (!path.isAbsolute(config["cwd"])) {
				const absPath = path.resolve(projectRoot, config["cwd"])
				console.log(`    convert config.cwd: ${config["cwd"]} => ${absPath}`)
				config["cwd"] = absPath
			}
		} else {
			config["cwd"] = projectRoot
		}
		console.log("    config: ", JSON.stringify(config))
		return config
	}
	return {}
}

function reportCoverage(projectRoot, config = {}) {

  var coverageMap = libCoverage.createCoverageMap(global[coverageVar]);

  const libReport = require("istanbul-lib-report");
  const reports = require("istanbul-reports");

  const options = {}
  if (config["watermarks"]) {
	options["watermarks"] = config["watermarks"];
  }
  if (config["report-dir"]) {
    if (path.isAbsolute(config["report-dir"])) {
      options["dir"] = config["report-dir"];
    } else {
      options["dir"] = path.resolve(config["cwd"], config["report-dir"]);
    }
  }
  console.log("reportOptions: ", options);

  // create a context for report generation
  const context = libReport.createContext({
    ...options,
    coverageMap,
  });

  const reporters = []
  console.log("config[reporter]: ", config["reporter"])
  if (config["reporter"]) {
	reporters.push(...config["reporter"])
  } else {
	reporters.push("text-summary")
  }

  for(const name of reporters) {
	const summary = reports.create(name);
  	summary.execute(context);
	console.log()
  }
}

module.exports = {
	setupCoverage,
    readConfig,
    reportCoverage
};
