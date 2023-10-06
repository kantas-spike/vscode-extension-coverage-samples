const path = require("path");
const covUtils = require("./lib/cov-utils")

const projectRoot = path.resolve(".")
const config = covUtils.readConfig(projectRoot)
covUtils.mergeCoverageFromRaw("merged", config)
