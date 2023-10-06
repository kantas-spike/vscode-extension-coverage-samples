# vscode-extension-coverage-samples

Visual Studio Codeの拡張機能開発時のテストカバレッジ出力方法の説明用サンプルコードです。

[Extension API | Visual Studio Code Extension API](https://code.visualstudio.com/api)を読むと、vscode拡張機能の開発方法がわかります。
そして、テスト方法は、[Testing Extensions | Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/testing-extension)に記載されています。

しかし、テストのカバレッジを出力する方法が記載されていません。

そこで、vscode拡張機能のテストカバレッジを出力する方法を調べてた結果を本プロジェクトにまとめました。

## 前提

私は`TypeScript`を使えないので、vscode拡張機能の言語に`JavaScript`を選択しています。

[Your First Extension | Visual Studio Code Extension API](https://code.visualstudio.com/api/get-started/your-first-extension)に従い、

`Yoman`をインストールします。

~~~shell
npm install -g yo generator-code
~~~

以下を実行し、
拡張機能のタイプに`JavaScript`を、パッケージマネージャーに`npm`を指定して、プロジェクトを作成しています。

~~~shell
yo code -t js --pkgManager npm
~~~

本プロジェクトは、`JavaScript`を使った開発の場合のテストカバレッジ出力方法のまとめになります。

## カバレッジツールについて調査

`yo code -t js`で生成したプロジェクトでは、[Mocha - the fun, simple, flexible JavaScript test framework](https://mochajs.org/)を使ったテストコードのサンプルが出力されます。(例: [test/suite/extension.test.js](./test/suite/extension.test.js))

キーワードとして、`mocha`と`テストカバレッジ`を使って、ググってみると、
[Istanbul, a JavaScript test coverage tool.](https://istanbul.js.org/)がよく検索されました。

`Istanbul`というのは、カバレッジ計測用のライブラリ群であり、
それらを内部で利用している`nyc`というコマンドラインツールを使えば、簡単にカバレッジ計測してくれるようです。

~~~shell
nyc mocha xxx.js
~~~

しかし、ここで問題があります。

通常のプロジェクトであれば、`nyc mocha`を実行するだけで問題ありませんが、
vscode拡張機能のテストは、新しくvscodeのプロセスが作成され、そのプロセス内でテストが実行されるため、`nyc`が上手く動作しません。[^1]

テスト用に作成されるvscodeプロセスでカバレッジを計測するためには、
テスト用vscodeプロセスが実行するテストコード内に、`Istanbul`ライブラリの機能を使ってカバレッジ機能を実装する必要がありそうです。

## カバレッジ機能の実装

テスト用vscodeプロセスが実行するファイルは、[test/suite/index.js](test/suite/index.js)です。

そのため、[test/suite/index.js](test/suite/index.js)内に、カバレッジ機能を実装しましょう。

まずは、`Istanbul`関連パッケージをインストールします。

~~~shell
npm install -D istanbul-lib-coverage istanbul-lib-hook istanbul-lib-instrument istanbul-lib-report istanbul-reports test-exclude
~~~

次に、カバレッジ用の関数を[lib/cov-utils.js](lib/cov-utils.js)に作成しました。

~~~js
const path = require("path");
const fs = require("fs");
const glob = require("glob");

const { createInstrumenter } = require("istanbul-lib-instrument");
const coverageVar = "$$cov_" + new Date().getTime() + "$$";
const instrumenter = createInstrumenter({
  coverageVariable: coverageVar,
});
const { hookRequire } = require("istanbul-lib-hook");
const libCoverage = require("istanbul-lib-coverage");

/**
 * カバレッジ計測のデフォルトオプション
 *
 * キー(文字列)と値(boolean)を持つ。
 *    `saveReport`: カバレッジレポート保存の有無(デフォルト値: true)、 `saveRawData`: カバレッジデータ保存の有無(デフォルト値: true)
 */
const defaultSetupOption = {
  saveReport: true,
  saveRawData: true,
};

/**
 * `istanbul-lib-*`を使ったカバレッジ計測をセットアップする
 *
 * @param {string} coverageName - カバレッジ名。カバレッジレポートやrawデータの保存先のフォルダー名になる
 * @param {*} config - 設定ファイルの設定データ
 * @param {*} options - セットアップオプション。
 * `saveReport`: カバレッジレポート保存の有無、`saveRawData`: カバレッジデータ保存の有無。
 * いずれも未指定時はカバレッジ計測のデフォルトオプションが採用される。
 */
function setupCoverage(coverageName, config, options = {}) {
  // console.log("options: ", options)
  options = Object.assign({}, defaultSetupOption, options);
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
    console.log("on exit!!");
    var coverageMap = libCoverage.createCoverageMap(global[coverageVar]);

    if (options["saveRawData"]) {
      saveRawCoverage(coverageMap, coverageName, config);
    }

    if (options["saveReport"]) {
      reportCoverage(coverageMap, coverageName, config);
    }
  });
}

/**
 * 設定ファイルを読み込む。
 *
 * 設定項目`cwd`の値が相対パスの場合、`projectRoot`を基準にした絶対パスに変換される。
 *
 * @param {*} projectRoot - プロジェクトのルートフォルダーのパス
 * @param {*} configFileName - 設定ファイル名
 * @returns {Object} 設定ファイルの内容
 */
function readConfig(projectRoot, configFileName = "coverage.config.json") {
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

/**
 * JSON形式のカバレッジデータの保存先フォルダー名
 */
const RAW_DIR_NAME = "raw";

/**
 * JSON形式のカバレッジrawデータを保存する。
 *
 * @param {libCoverage.CoverageMap} coverageMap - カバレッジマップ
 * @param {String} coverageName - カバレッジ名。カバレッジレポートやrawデータの保存先のフォルダー名になる
 * @param {Object} config - 設定ファイルの設定データ
 */
function saveRawCoverage(coverageMap, coverageName, config = {}) {
  console.log(coverageMap);

  const outputDir = path.join(getReportDir(config), RAW_DIR_NAME);

  console.log("raw dir: ", outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let rawJsonPath;
  if (coverageName) {
    rawJsonPath = path.join(outputDir, `${coverageName}.json`);
  } else {
    rawJsonPath = path.join(outputDir, `pid_${process.pid}.json`);
  }
  console.log("raw json path: ", rawJsonPath);
  fs.writeFileSync(rawJsonPath, JSON.stringify(coverageMap));
}

/**
 * rawデータフォルダーにある全JSONファイルを取得し、カバレッジマップにマージし、レポートを作成する
 *
 * @param {String} coverageName - カバレッジ名。カバレッジレポートやrawデータの保存先のフォルダー名になる
 * @param {Object} config - 設定ファイルの設定データ
 */
function mergeCoverageFromRaw(coverageName, config = {}) {
  var coverageMap = libCoverage.createCoverageMap({});
  const rawDir = path.join(getReportDir(config), RAW_DIR_NAME);
  for (const json of glob.globSync(path.join(rawDir, "*.json"))) {
    console.log("merage raw json: ", json);
    const map = fs.readFileSync(json, "utf-8");
    coverageMap.merge(JSON.parse(map));
  }
  reportCoverage(coverageMap, coverageName, config);
}

/**
 * レポート保存先フォルダー名
 */
const REPORT_DIR_NAME = "coverage";

/**
 * カバレッジレポートの出力先フォルダーを取得する
 *
 * @param {Object} config - 設定ファイルの設定データ
 * @returns {String} 出力フォルダーのパス
 */
function getReportDir(config) {
  if (config["report-dir"]) {
    if (path.isAbsolute(config["report-dir"])) {
      return config["report-dir"];
    } else {
      return path.resolve(config["cwd"], config["report-dir"]);
    }
  } else {
    return path.join(config["cwd"], REPORT_DIR_NAME);
  }
}

/**
 * カバレッジレポートを出力する
 *
 * @param {libCoverage.CoverageMap} coverageMap - カバレッジマップ
 * @param {String} coverageName - カバレッジ名。カバレッジレポートやrawデータの保存先のフォルダー名になる
 * @param {Object} config - 設定ファイルの設定データ
 */
function reportCoverage(coverageMap, coverageName, config = {}) {
  const libReport = require("istanbul-lib-report");
  const reports = require("istanbul-reports");

  const options = {};
  if (config["watermarks"]) {
    options["watermarks"] = config["watermarks"];
  }
  options["dir"] = path.join(getReportDir(config), coverageName);
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
~~~

### 設定ファイル

プロジェクトフォルダー直下に、[coverage.config.json](./coverage.config.json)を置くことで、
カバレッジ対象のjsファイル、カバレッジレポートの種類や出力先を設定できます。

~~~json
// coverage.config.json
{
    "cwd": ".",
    "extension": [".js"],
    "include": ["**"],
    "exclude": ["coverage/**", "node_modules/**", "test/**" ],
    "reporter": ["text", "html"],
    "report-dir": "./coverage"
}
~~~

## 使い方

[test/suite/index.js](test/suite/index.js)内でカバレッジを利用するためには、以下のようにします。

~~~js
const path = require("path");
const Mocha = require("mocha");
const glob = require("glob");
const covUtils = require("../../lib/cov-utils");

function run() {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  const testsRoot = path.resolve(__dirname, "..");
  const projectRoot = path.resolve(path.join(testsRoot, ".."));
  const config = covUtils.readConfig(projectRoot);
  covUtils.setupCoverage("test", config);

  return new Promise((c, e) => {
    const testFiles = new glob.Glob("**/**.test.js", { cwd: testsRoot });
    const testFileStream = testFiles.stream();

    testFileStream.on("data", (file) => {
      // Add files to the test suite
      mocha.addFile(path.resolve(testsRoot, file));
    });
    testFileStream.on("error", (err) => {
      e(err);
    });
    testFileStream.on("end", () => {
      try {
        // Run the mocha test
        mocha.run((failures) => {
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

module.exports = {
  run,
};
~~~

では、サイドバーの`実行とデバッグ`から`Extension Tests`を実行してみましょう。

以下のようにカバレッジ結果の出力されるはずです。(デバッグ用のログを出力しています。すみません。)

そして、プロジェクトフォルダー直下の`coverage/{カバレッジ名}/index.html`を開くとブラウザで詳細なカバレッジレポートを確認できます。
上記の例の場合は、`coverage/test/index.html`がカバレッジレポートになります。

~~~console
projectRoot:  /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage
readConfig:
    convert config.cwd: . => /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage
    config:  {"cwd":"/Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage","extension":[".js"],"include":["**"],"exclude":["coverage/**","node_modules/**","test*/**",".vscode-test/**"],"reporter":["text","html"],"report-dir":"./coverage"}

matcher:
     {"relativePath":true,"cwd":"/Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage","exclude":["coverage/**","node_modules/**","test*/**",".vscode-test/**","node_modules/**","**/node_modules/**"],"excludeNodeModules":true,"include":["**/**","**"],"extension":[".js"],"reporter":["text","html"],"report-dir":"./coverage","excludeNegated":[]}

matched:
    /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/extension.js
    /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/hoge.js

  Extension Test Suite
    ✔ Sample test
    ✔ hoge
  2 passing (203ms)
on exit!!
CoverageMap {data: {…}}
raw dir:  /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/coverage/raw
raw json path:  /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/coverage/raw/test.json
reportOptions:  {dir: '/Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/coverage/test'}
config[reporter]:  (2) ['text', 'html']
--------------|---------|----------|---------|---------|-------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|-------------------
All files     |      50 |       50 |      25 |      50 |
 extension.js |   33.33 |      100 |       0 |   33.33 | 15-27
 hoge.js      |      75 |       50 |     100 |      75 | 5
--------------|---------|----------|---------|---------|-------------------
~~~

### カバレッジデータのマージについて

また、プロジェクトフォルダー直下の`coverage/raw/{カバレッジ名}.json`に、カバレッジデータをJSON形式に変換したデータ(rawデータ)が保存されています。

`istanbul`を使ったカバレッジ計測は、テストランナーのプロセス単位に作成されるため、
単体テストやE2Eテストが複数のテストランナーに別れる場合は、カバレッジデータをマージしてから、カバレッジレポートを出力する必要があります。

例えば、以下の2つにテストランナーが分かれている場合、

- [test/runTest.js](test/runTest.js)
- [test2/runTest.js](test2/runTest.js)

以下のコマンドでカバレッジレポートを出力できますが、`カバレッジ名`を同じ名前にすると、レポートやrawデータが上書きされてしまいます。

~~~shell
 node ./test/runTest.js
~~~

~~~shell
 node ./test2/runTest.js
~~~

そこで、一方の`カバレッジ名`を別の名前に変更してからコマンドを実行する必要があります。

~~~js
// test2/suite/index.js
const path = require("path");
const Mocha = require("mocha");
const glob = require("glob");
const covUtils = require("../../lib/cov-utils");

function run() {
  // ...略...
  const testsRoot = path.resolve(__dirname, "..");
  const projectRoot = path.resolve(path.join(testsRoot, ".."));
  const config = covUtils.readConfig(projectRoot);
  covUtils.setupCoverage("test2", config); // <=カバレッジ名を重複しない名前に変更

  return new Promise((c, e) => {
    // ...略...
  });
}

module.exports = {
  run,
};
~~~

上記の対応により、rawデータを別々に出力できるようになりました。

テストランナーごとに分割されたカバレッジデータをマージするため、
[merge-coverage.js](merge-coverage.js)を用意しました。

以下のように実行すると、rawデータをマージしたレポートが`coverage/merged/index.html`に作成されます。

~~~js
% node ./merge-coverage.js
projectRoot:  /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage
readConfig:
    convert config.cwd: . => /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage
    config:  {"cwd":"/Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage","extension":[".js"],"include":["**"],"exclude":["coverage/**","node_modules/**","test*/**",".vscode-test/**"],"reporter":["text","html"],"report-dir":"./coverage"}
merage raw json:  /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/coverage/raw/test2.json
merage raw json:  /Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/coverage/raw/test.json
reportOptions:  {
  dir: '/Users/kanta/hacking/spike/004_vscodeExtensionTest_with_coverage/coverage/merged'
}
config[reporter]:  [ 'text', 'html' ]
--------------|---------|----------|---------|---------|-------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|-------------------
All files     |      60 |      100 |      25 |      60 |
 extension.js |   33.33 |      100 |       0 |   33.33 | 15-27
 hoge.js      |     100 |      100 |     100 |     100 |
--------------|---------|----------|---------|---------|-------------------
~~~

## 参考

- [Extension API | Visual Studio Code Extension API](https://code.visualstudio.com/api)
  - [Testing Extensions | Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/testing-extension)

- カバレッジの実装の参考にしたサイト
  - [Visual Studio Code拡張機能のテスト環境を構築する(TypeScript) | lps da DAZ Studio user](https://lowpolysnow.com/wp/20200202/396/)
  - [Question about the docs / programmatic API · Issue #71 · istanbuljs/istanbuljs](https://github.com/istanbuljs/istanbuljs/issues/71#issuecomment-455172730)
  - [istanbuljs example of programmatic instrumentation, and coverage report.](https://gist.github.com/cancerberoSgx/c4ea6edd2862af0fc229598d8531fddb)
  - [istanbuljs/packages/istanbul-lib-report at master · istanbuljs/istanbuljs](https://github.com/istanbuljs/istanbuljs/tree/master/packages/istanbul-lib-report)

[^1]: 拡張機能のテストは`node ./test/runTest.js`により実行されます。`runTests`関数がテスト用のvscodeプロセスを起動し、`./test/suite/index.js`を実行します。
