const assert = require( 'assert' );
const proc = require('child_process');
const fs = require('fs');
const rollup = require( 'rollup' );
const assign = require( 'object-assign' );
const typescript = require( '..' );

process.chdir( __dirname );

// Evaluate a bundle (as CommonJS) and return its exports.
async function evaluate ( bundle ) {
	const module = { exports: {} };

	new Function( 'module', 'exports', (await bundle.generate({ format: 'cjs' })).code )( module, module.exports );

	return module.exports;
}

// Short-hand for rollup using the typescript plugin.
function bundle ( main, options ) {
	return rollup.rollup({
		input: main,
		plugins: [ typescript( options ) ]
	});
}

describe( 'rollup-plugin-typescript', function () {
	this.timeout( 5000 );

	it( 'runs code through typescript', async () => {
		const b = await bundle( 'sample/basic/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		assert.ok( code.indexOf( 'number' ) === -1, code );
		assert.ok( code.indexOf( 'const' ) === -1, code );
	});

	it( 'ignores the declaration option', () => {
		return bundle( 'sample/basic/main.ts', { declaration: true });
	});

	it( 'handles async functions', async () => {
		const b = await bundle( 'sample/async/main.ts' );
		const wait = await evaluate(b);

		return wait(3);
	});

	it( 'does not duplicate helpers', async () => {
		const b = await bundle( 'sample/dedup-helpers/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		// The `__extends` function is defined in the bundle.
		assert.ok( code.indexOf( 'function __extends' ) > -1, code );

		// No duplicate `__extends` helper is defined.
		assert.equal( code.indexOf( '__extends$1' ), -1, code );
	});

	it( 'transpiles `export class A` correctly', async () => {
		const b = await bundle( 'sample/export-class-fix/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		assert.equal( code.indexOf( 'class' ), -1, code );
		assert.ok( code.indexOf( 'var A = (function' ) !== -1, code );
		assert.ok( code.indexOf( 'var B = (function' ) !== -1, code );
		assert.ok( code.indexOf( 'export { A, B };' ) !== -1, code );
	});

	it( 'transpiles ES6 features to ES5 with source maps', async () => {
		const b = await bundle( 'sample/import-class/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		assert.equal( code.indexOf( 'class' ), -1, code );
		assert.equal( code.indexOf( '...' ), -1, code );
		assert.equal( code.indexOf( '=>' ), -1, code );
	});

	it( 'reports diagnostics and throws if errors occur during transpilation', async () => {
		let errored;
		try {
			await bundle( 'sample/syntax-error/missing-type.ts' );
		} catch (err) {
			errored = true;
			assert.ok( err.message.indexOf( 'There were TypeScript errors transpiling' ) !== -1, 'Should reject erroneous code.' );
		}

		assert.ok(errored);
	});

	it( 'works with named exports for abstract classes', async () => {
		const b = await bundle( 'sample/export-abstract-class/main.ts' );
		const { code } = await b.generate({ format: 'es' });
		assert.ok( code.length > 0, code );
	});

	it( 'should use named exports for classes', async () => {
		const b = await bundle( 'sample/export-class/main.ts' );
		assert.equal( (await evaluate( b )).foo, 'bar' );
	});

	it( 'supports overriding the TypeScript version', async () => {
		const b = await bundle('sample/overriding-typescript/main.ts', {
			// Don't use `tsconfig.json`
			tsconfig: false,

			// test with a mocked version of TypeScript
			typescript: fakeTypescript({
				version: '1.8.0-fake',

				transpileModule: () => {
					// Ignore the code to transpile. Always return the same thing.
					return {
						outputText: 'export default 1337;',
						diagnostics: [],
						sourceMapText: JSON.stringify({ mappings: '' })
					};
				}
			})
		});

		assert.equal( await evaluate( b ), 1337 );
	});

	describe( 'strictNullChecks', () => {
		it( 'is enabled for versions >= 1.9.0', async () => {
			await bundle( 'sample/overriding-typescript/main.ts', {
				tsconfig: false,
				strictNullChecks: true,

				typescript: fakeTypescript({
					version: '1.9.0-fake',
					transpileModule ( code, options ) {
						assert.ok( options.compilerOptions.strictNullChecks,
							'strictNullChecks should be passed through' );

						return {
							outputText: '',
							diagnostics: [],
							sourceMapText: JSON.stringify({ mappings: '' })
						};
					}
				})
			});
		});

		it( 'is disabled with a warning < 1.9.0', async () => {
			let warning = '';

			console.warn = function (msg) {
				warning = msg;
			};

			await rollup.rollup({
				input: 'sample/overriding-typescript/main.ts',
				plugins: [
					typescript({
						tsconfig: false,
						strictNullChecks: true,

						typescript: fakeTypescript({
							version: '1.8.0-fake'
						})
					})
				]
			});

			assert.notEqual( warning.indexOf( "'strictNullChecks' is not supported" ), -1 );
		});
	});

	it( 'should not resolve .d.ts files', async () => {
		const b = await bundle( 'sample/dts/main.ts' );
		assert.deepEqual( b.imports, [ 'an-import' ] );
	});

	it( 'should transpile JSX if enabled', async () => {
		const b = await bundle( 'sample/jsx/main.tsx', { jsx: 'react' });
		const { code } = await b.generate({ format: 'es' });

		assert.notEqual( code.indexOf( ' __assign = ' ), -1,
			'should contain __assign definition' );

		const usage = code.indexOf( 'React.createElement("span", __assign({}, props), "Yo!")' );

		assert.notEqual( usage, -1, 'should contain usage' );
	});

	it( 'should throw on bad options', () => {
		assert.throws( () => {
			bundle( 'does-not-matter.ts', {
				foo: 'bar'
			});
		}, /Couldn't process compiler options/ );
	});

	it( 'prevents errors due to conflicting `sourceMap`/`inlineSourceMap` options', () => {
		return bundle( 'sample/overriding-typescript/main.ts', {
			inlineSourceMap: true
		});
	});

	it ( 'should not fail if source maps are off', () => {
		return bundle( 'sample/overriding-typescript/main.ts', {
			inlineSourceMap: false,
			sourceMap: false
		});
	});

	it( 'does not include helpers in source maps', async () => {
		const b = await bundle( 'sample/dedup-helpers/main.ts', {
			sourceMap: true
		});

		const { map } = await b.generate({
			format: 'es',
			sourcemap: true
		});

		assert.ok( map.sources.every( source => source.indexOf( 'typescript-helpers' ) === -1) );
	});

	describe( 'typescript 2', () => {
		const TS2_LIB = './node_modules/typescript/lib/typescript.js';
		let ts2InstallPromise;

		before(() => {
			/**
			 * Some tests depend on TS2 being installed.  For backwards compatibility this project
			 * will continue to have TS 1.8.9 as it's dependency.  But for these tests, we will install
			 * TS2 into a specific folder and then require it in for this test.
			 */

			const exists = fs.existsSync(TS2_LIB);
			if (!exists) {
				ts2InstallPromise = new Promise((resolve, reject) => {
					proc.exec('npm install --prefix ./ typescript@2', error => error ? reject(error) : resolve());
				});
			}
		});

		it( 'imports new ts2 helpers', async () => {
			await ts2InstallPromise;

			const b = await bundle( 'sample/ts2-features/main.ts', {
				typescript: require( TS2_LIB ),
				useTSLibFallback: false
			});

			const { code } = await b.generate({ format: 'cjs' });

			assert.ok( code.includes('function __makeTemplateObject') );
			assert.ok( eval(code) ); // if compiled in TS2 will be true;
		});

		it( 'will use the tsHelper fallback for legacy usage', async () => {
			const b = await bundle( 'sample/ts2-features/main.ts', {
				useTSLibFallback: true
			});

			const { code } = await b.generate({ format: 'cjs' });

			assert.ok( !code.includes('function __makeTemplateObject') );
			assert.ok( !eval(code) );  // if compiled in TS <2 will be false;
		});
	});
});

function fakeTypescript ( custom ) {
	return assign({
		transpileModule () {
			return {
				outputText: '',
				diagnostics: [],
				sourceMapText: JSON.stringify({ mappings: '' })
			};
		},

		convertCompilerOptionsFromJson ( options ) {
			[
				'include',
				'exclude',
				'typescript',
				'tsconfig'
			].forEach( option => {
				if ( option in options ) {
					throw new Error( 'unrecognized compiler option "' + option + '"' );
				}
			});

			return {
				options,
				errors: []
			};
		}
	}, custom);
}
