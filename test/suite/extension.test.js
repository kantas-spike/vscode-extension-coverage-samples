const assert = require('assert');

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = require('vscode');
const myExtension = require('../../extension');
const hoge = require('../../hoge')

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
		assert.ok(myExtension.activate)
	});

	test("hoge", () => {
		assert.strictEqual(false, hoge.isMinus(0))
		assert.strictEqual(false, hoge.isMinus(100))
		assert.strictEqual(true, hoge.isMinus(-1))
		assert.strictEqual(true, hoge.isMinus(-100))
	})
});
