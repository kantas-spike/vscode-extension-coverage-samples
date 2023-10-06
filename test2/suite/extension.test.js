const assert = require('assert');

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = require('vscode');
const myExtension = require('../../extension');
const hoge = require('../../hoge')

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test("hoge", () => {
		assert.strictEqual(true, hoge.isMinus(-1))
		assert.strictEqual(true, hoge.isMinus(-100))
	})
});
