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

次に、カバレッジ用の関数を[test/suite/cov-utils.js](test/suite/cov-utils.js)に作成しました。

~~~js
const path = require("path");
const fs = require("fs");

const { createInstrumenter } = require("istanbul-lib-instrument");
const coverageVar = "$$cov_" + new Date().getTime() + "$$";
const instrumenter = createInstrumenter({
  coverageVariable: coverageVar,
});
const { hookRequire } = require("istanbul-lib-hook");
var libCoverage = require("istanbul-lib-coverage");

// カバレッジのセットアップ
function setupCoverage(projectRoot) {
  console.log("projectRoot: ", projectRoot);
  const config = readConfig(projectRoot);
  // console.log("config: ", config)
  const TestExclude = require("test-exclude");
  const matchOption = Object.keys(config)
    .filter((k) => ["cwd", "extension", "include", "exclude"])
    .reduce((obj, k) => {
      obj[k] = config[k];
      return obj;
    }, {});
  // console.log("matchOption: ", matchOption)

  // カバレッジ対象のファイルを選択
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

  // テスト用vscodeプロセス終了時にカバレッジレポート出力
  process.on("exit", () => {
    reportCoverage(projectRoot, config);
  });
}

// 設定ファイル読み込み用
function readConfig(projectRoot) {
  console.log("readConfig: ");
  const configPath = path.join(projectRoot, "coverage.config.json");
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

// カバレッジレポート生成
function reportCoverage(projectRoot, config = {}) {
  var coverageMap = libCoverage.createCoverageMap(global[coverageVar]);

  const libReport = require("istanbul-lib-report");
  const reports = require("istanbul-reports");

  const options = {};
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
  setupCoverage,
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
const covUtils = require("./cov-utils"); // require

function run() {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  const testsRoot = path.resolve(__dirname, "..");
  const projectRoot = path.resolve(path.join(testsRoot, ".."));
  covUtils.setupCoverage(projectRoot); // ここでカバレッジのセットアップを呼ぶだけです

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

以下のようにカバレッジ結果の出力されるはずです。
また、プロジェクトフォルダー直下の`coverage/index.html`を開くとブラウザで詳細なカバレッジレポートを確認できます。(デバッグ用のログを出力しています。すみません。)

~~~console
projectRoot:  ~/hacking/spike/004_vscode拡張機能のテストでcoverageを計測する
readConfig:
    convert config.cwd: . => ~/hacking/spike/004_vscode拡張機能のテストでcoverageを計測する
    config:  {"cwd":"~/hacking/spike/004_vscode拡張機能のテストでcoverageを計測する","extension":[".js"],"include":["**"],"exclude":["coverage/**","node_modules/**","test/**"],"reporter":["text","html"],"report-dir":"./coverage"}

matcher:
     {"relativePath":true,"cwd":"~/hacking/spike/004_vscode拡張機能のテストでcoverageを計測する","exclude":["coverage/**","node_modules/**","test/**","node_modules/**","**/node_modules/**"],"excludeNodeModules":true,"include":["**/**","**"],"extension":[".js"],"reporter":["text","html"],"report-dir":"./coverage","excludeNegated":[]}

matched:
    ~/hacking/spike/004_vscode拡張機能のテストでcoverageを計測する/extension.js
    ~/hacking/spike/004_vscode拡張機能のテストでcoverageを計測する/hoge.js

  Extension Test Suite
    ✔ Sample test
    ✔ hoge
  2 passing (195ms)
reportOptions:  {dir: '~/hacking/spike/004_vscode拡張機能のテストでcoverageを計測する/coverage'}
config[reporter]:  (2) ['text', 'html']
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
