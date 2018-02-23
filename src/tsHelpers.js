import * as fs from 'fs';
import * as path from 'path';
import * as typescript from 'typescript';

// The injected id for helpers. Intentially invalid to prevent helpers being included in source maps.
export const helpersId = '\0typescript-helpers';
const helpersSourceFallback = fs.readFileSync( path.resolve( __dirname, '../src/tsHelpersFallback.js' ), 'utf-8' );
const helpersImportFallback = `\nimport { __assign, __awaiter, __extends, __decorate, __metadata, __param, __generator } from '${helpersId}';`;

let helpersSource;
let helpersImport;

export function getHelpersSource ({ useTSLibFallback }) {
	if (helpersSource) {
		return helpersSource;
	}

	function findRootFolder ( start ) {
		function check ( dir ) {
			return fs.existsSync(path.join(dir, 'package.json')) &&
				fs.existsSync(path.join(dir, 'node_modules'));
		}

		if (typeof start === 'string') {
			if (start[start.length - 1] !== path.sep) {
				start += path.sep;
			}
			start = start.split(path.sep);
		}
		if (!start.length) {
			throw new Error('node_modules not found in path');
		}
		start.pop();

		const dir = start.join(path.sep);
		try {
			if (check(dir)) {
				return dir;
			}
		} catch (e) {
			// do nothing with the error, continue searching
		}

		return findRootFolder(start);
	}

	if (!useTSLibFallback) {
		const rootFolder = findRootFolder( module.parent.filename );
		const tsLibPath = path.resolve( rootFolder, 'node_modules/tslib/' );
		if (fs.existsSync( tsLibPath )) {
			const tslibPkgPath = path.resolve( tsLibPath, 'package.json' );
			if (fs.existsSync(tslibPkgPath)) {
				const tslibSrc = fs.readFileSync( tslibPkgPath, 'utf-8' );
				const tslibPkg = JSON.parse( tslibSrc );
				const helperSourceFile = tslibPkg.module || tslibPkg['jsnext:main'] || tslibPkg.main;
				const helperSourcePath = path.resolve( tsLibPath, helperSourceFile);

				if (fs.existsSync( helperSourcePath )) {
					return fs.readFileSync( helperSourcePath, 'utf-8' );
				}
			}
		}
	}

	return helpersSourceFallback;
}

export function getHelpersImport ({ useTSLibFallback }) {
	if (helpersImport) {
		return helpersImport;
	}

	function isNodeExported ( node ) {
		const modifiers = node.modifiers;
		if (!modifiers || !Array.isArray(modifiers)) {
			return false;
		}

		for (let i = 0, length = modifiers.length; i < length; i++) {
			if (modifiers[i].kind === typescript.SyntaxKind.ExportKeyword) {
				return true;
			}
		}
		return false;
	}

	function getNodeName ( node ) {
		if (node.name && node.name.text) {
			return node.name.text;
		}

		const declarations = node.declarationList && node.declarationList.declarations;
		if (declarations) {
			for (let i = 0, length = declarations.length; i < length; i++) {
				const name = getNodeName(declarations[i]);
				if (name) {
					return name;
				}
			}
		}
		return false;
	}

	function findExportsInSourceFile ( sourceFile ) {
		const exportFuncs = [];
		findExportsInNode(sourceFile);

		function findExportsInNode ( node ) {
			if (isNodeExported(node)) {
				const name = getNodeName(node);
				exportFuncs.push(name.replace('___', '__'));
			}
			typescript.forEachChild(node, findExportsInNode);
		}

		return exportFuncs;
	}

	const helpersSource = getHelpersSource({ useTSLibFallback });
	if (helpersSource) {
		const helperSourceFile = typescript.createSourceFile('tslib.js', helpersSource, typescript.ScriptTarget.Latest, true);
		const exportedFuncs = findExportsInSourceFile(helperSourceFile);
		if (exportedFuncs && exportedFuncs.length > 0) {
			return `\nimport { ${ exportedFuncs.join(', ') } } from '${helpersId}';`;
		}
	}
	return helpersImportFallback;
}
