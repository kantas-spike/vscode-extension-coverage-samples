const path = require("path");
const fs = require("fs");
const glob = require('glob')

const { createInstrumenter } = require("istanbul-lib-instrument");
const coverageVar = "$$cov_" + new Date().getTime() + "$$";
const instrumenter = createInstrumenter({
  coverageVariable: coverageVar,
});
const { hookRequire } = require("istanbul-lib-hook");
var libCoverage = require("istanbul-lib-coverage");

function setupCoverage(coverageName, config, options={'saveReport': true, 'saveRawData': true }) {
  // console.log("options: ", options)

  // console.log("config: ", config)
  const TestExclude = require("test-exclude");
  const matchOption = Object.keys(config)
    .filter((k) => ["cwd", "extension", "include", "exclude"])
    .reduce((obj, k) => {
      obj[k] = config[k];
      return obj;
    }, {});
  // console.log("matchOption: ", matchOption)

  const matcher = new TestExclude({ ...matchOption });
  console.log("\nmatcher:\n    ", JSON.stringify(matcher));
  console.log("\nmatched: ");
  hookRequire(
    (filePath) => {
      const r = matcher.shouldInstrument(filePath);
      if (r) {
        console.log("   ", filePath);
      }
      return r;
    },
    (code, { filename }) => instrumenter.instrumentSync(code, filename)
  );
  global[coverageVar] = {};

  process.on("exit", () => {
    console.log("on exit!!")
    var coverageMap = libCoverage.createCoverageMap(global[coverageVar]);

    if (options['saveRawData']) {
      saveRawCoverage(coverageMap, coverageName, config)
    }

    if (options['saveReport']) {
      reportCoverage(coverageMap, coverageName, config);
    }
  });
}

function readConfig(projectRoot, configFileName="coverage.config.json") {
  console.log("projectRoot: ", projectRoot);
  console.log("readConfig: ");
  const configPath = path.join(projectRoot, configFileName);
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config["cwd"]) {
      if (!path.isAbsolute(config["cwd"])) {
        const absPath = path.resolve(projectRoot, config["cwd"]);
        console.log(`    convert config.cwd: ${config["cwd"]} => ${absPath}`);
        config["cwd"] = absPath;
      }
    } else {
      config["cwd"] = projectRoot;
    }
    console.log("    config: ", JSON.stringify(config));
    return config;
  }
  return {};
}

const RAW_DIR_NAME = "raw"

function saveRawCoverage(coverageMap, coverageName, config = {}) {
  console.log(coverageMap)

  const outputDir = path.join(getReportDir(config), RAW_DIR_NAME)

  console.log("raw dir: ", outputDir)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {recursive: true})
  }

  let rawJsonPath
  if (coverageName) {
    rawJsonPath = path.join(outputDir, `${coverageName}.json`)
  } else {
    rawJsonPath = path.join(outputDir, `pid_${process.pid}.json`)
  }
  console.log("raw json path: ", rawJsonPath)
  fs.writeFileSync(rawJsonPath, JSON.stringify(coverageMap))
}


function mergeCoverageFromRaw(coverageName, config = {}) {
  var coverageMap = libCoverage.createCoverageMap({});
  const rawDir = path.join(getReportDir(config), RAW_DIR_NAME)
  for(const json of glob.globSync(path.join(rawDir, "*.json"))) {
    console.log("merage raw json: ", json)
    const map = fs.readFileSync(json, 'utf-8')
    coverageMap.merge((JSON.parse(map)))
  }
  reportCoverage(coverageMap, coverageName, config)
}

const REPORT_DIR_NAME = 'coverage'

function getReportDir(config) {
  if (config["report-dir"]) {
    if (path.isAbsolute(config["report-dir"])) {
      return config["report-dir"];
    } else {
      return path.resolve(config["cwd"], config["report-dir"]);
    }
  } else {
    return path.join(config["cwd"], REPORT_DIR_NAME)
  }
}

function reportCoverage(coverageMap, coverageName, config = {}) {
  const libReport = require("istanbul-lib-report");
  const reports = require("istanbul-reports");

  const options = {};
  if (config["watermarks"]) {
    options["watermarks"] = config["watermarks"];
  }
  options["dir"] = path.join(getReportDir(config), coverageName)
  console.log("reportOptions: ", options);

  // create a context for report generation
  const context = libReport.createContext({
    ...options,
    coverageMap,
  });

  const reporters = [];
  console.log("config[reporter]: ", config["reporter"]);
  if (config["reporter"]) {
    reporters.push(...config["reporter"]);
  } else {
    reporters.push("text-summary");
  }

  for (const name of reporters) {
    const summary = reports.create(name);
    summary.execute(context);
    console.log();
  }
}

module.exports = {
  readConfig,
  setupCoverage,
  mergeCoverageFromRaw,
};
