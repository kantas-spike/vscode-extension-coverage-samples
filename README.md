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

さらに調べてみると、作成されるvscodeプロセスでカバレッジを計測するためには、[bcoe/c8: output coverage reports using Node.js' built in coverage](https://github.com/bcoe/c8)を利用すると上手くいきそうなことがわかりました。 [^2]

この`c8`は、`node.js`に組み込まれているカバレッジ計測機能を利用したツールのようです。[^3]
そのため、テストコードにカバレッジの設定を追加する必要がありません。

## c8の準備

以下でインストールできます。

~~~shell
npm install -D c8
~~~

また、`c8`は`nyc`と同じ`Istanbul`ライブラリを利用しているため、設定ファイルは同様のものを利用できます。

例えば、プロジェクトフォルダー直下に、以下のような[.c8rc.json](./.c8rc.json)を作成します。

~~~json
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

そして、[test/suite/index.js](test/suite/index.js)内でカバレッジを利用するためには、以下のようにします。
カバレッジレポートは`./coverage`配下に作成され、カバレッジデータのrawデータは`./coverage/tmp`内に作成されます。

`./coverage`の内容は、`c8`コマンドを実行するたびに、削除されてからレポートが再作成されます。

~~~shell
% npx c8 -c .c8rc.json node test/runTest.js
#...略...
  Extension Test Suite
    ✔ Sample test
    ✔ hoge
  2 passing (3ms)
[main 2023-10-07T23:35:01.438Z] Extension host with pid 23126 exited with code: 0, signal: unknown.
Exit code:   0
Done

--------------|---------|----------|---------|---------|-------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|-------------------
All files     |   55.31 |       75 |   33.33 |   55.31 |
 extension.js |   47.22 |      100 |       0 |   47.22 | 11-28,31
 hoge.js      |   81.81 |    66.66 |     100 |   81.81 | 5-6
--------------|---------|----------|---------|---------|-------------------
~~~

そのため、別のテスト結果のカバレッジデータをマージしたい場合は、`--clean false`オプションをつけて、
`./coverage`フォルダーを削除しないようにします。

~~~shell
% npx c8 --cleran false -c .c8rc.json node test2/runTest.js
# ...略...
  Extension Test Suite
    ✔ hoge
  1 passing (4ms)
[main 2023-10-07T23:42:27.619Z] Extension host with pid 23799 exited with code: 0, signal: unknown.
Exit code:   0
Done

--------------|---------|----------|---------|---------|-------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|-------------------
All files     |   59.57 |      100 |   33.33 |   59.57 |
 extension.js |   47.22 |      100 |       0 |   47.22 | 11-28,31
 hoge.js      |     100 |      100 |     100 |     100 |
--------------|---------|----------|---------|---------|-------------------
~~~

## 参考

- [Command-line API | Node.js v18.18.0 Documentation](https://nodejs.org/docs/latest-v18.x/api/cli.html#node_v8_coveragedir)
- [bcoe/c8: output coverage reports using Node.js' built in coverage](https://github.com/bcoe/c8)
- [Istanbul, a JavaScript test coverage tool.](https://istanbul.js.org/)

[^1]: 拡張機能のテストは`node ./test/runTest.js`により実行されます。`runTests`関数がテスト用のvscodeプロセスを起動し、`./test/suite/index.js`を実行します。
[^2]: テスト用vscodeプロセスが実行するテストコード内に、`Istanbul`ライブラリの機能を使ってカバレッジ機能を実装する方法も検討しましたが、[Electron | Playwright](https://playwright.dev/docs/api/class-electron)を使ったテストの場合上手くいきませんでした。
[^3]: [Command-line API | Node.js v18.18.0 Documentation](https://nodejs.org/docs/latest-v18.x/api/cli.html#node_v8_coveragedir)
