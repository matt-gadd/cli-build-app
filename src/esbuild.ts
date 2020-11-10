const { build: esbuild } = require('esbuild');
const fs = require('fs');
const util = require('util');
const path = require('path');
const watcher = require('@parcel/watcher');

const postcss = require('postcss');
const cssModules = require('postcss-modules');
const copyAssets = require('postcss-copy-assets');
const atImport = require('postcss-import');
const hasLoader = require('@dojo/webpack-contrib/static-build-loader/loader');
const features = require('@dojo/webpack-contrib/static-build-loader/features/modern.json');

const output = 'output/dev';
const src = 'src';
const entry = 'main';
const html = 'index';

const css = () => {
	let cssOutput = '';
	return {
		name: 'css-plugin',
		output: () => cssOutput,
		setup(build: any) {
			build.onLoad({ filter: /\.css/ }, async (args: any) => {
				let cssModule = '';
				const css = await util.promisify(fs.readFile)(args.path, 'utf8');
				const cssModuleExists = fs.existsSync(`${args.path}.js`);
				const postCssPlugins = cssModuleExists
					? [atImport(), copyAssets({ base: output })]
					: [atImport(), cssModules({ getJSON() {} }), copyAssets({ base: output })];

				const postCssOptions = { from: args.path, to: `${output}/${entry}.css` };
				const result = await postcss(postCssPlugins).process(css, postCssOptions);

				if (cssModuleExists) {
					cssModule = await util.promisify(fs.readFile)(`${args.path}.js`, 'utf8');
				} else {
					let exportTokens: any = {};
					result.messages.forEach((message: any) => {
						if (message.plugin === 'postcss-modules') {
							exportTokens = message.exportTokens;
						}
					});
					Object.keys(exportTokens).forEach((key) => {
						key = key.replace(/-(.){1}/g, (match, offset) => offset.toUpperCase());
						cssModule += `export const ${key} = '${exportTokens[key]}';`;
					});
				}
				const relative = path.relative(process.cwd(), args.path);
				cssOutput += `
/* ${relative} */
${result.css}`;
				return { contents: cssModule };
			});
		}
	};
};

const has = () => {
	return {
		name: 'has-plugin',
		setup(build: any) {
			build.onLoad({ filter: /\.mjs/ }, async (args: any) => {
				let source = await util.promisify(fs.readFile)(args.path, 'utf8');
				source = hasLoader.default.bind({
					query: {
						features: {
							...features,
							'dojo-debug': false,
							'cldr-elide': true,
							'build-time-rendered': false,
							test: false,
							'build-elide': true
						}
					}
				})(source);
				return { contents: source, loader: 'default' };
			});
		}
	};
};
const cssPlugin = css();
const hasPlugin = has();
const extension = fs.existsSync(`./${src}/${entry}.tsx`) ? 'tsx' : 'ts';

export const build = async () => {
	try {
		await esbuild({
			entryPoints: [`./${src}/${entry}.${extension}`],
			outfile: `./${output}/${entry}.js`,
			format: 'esm',
			bundle: true,
			sourcemap: true,
			inject: [`node_modules/@dojo/webpack-contrib/bootstrap-plugin/sync.js`, `./${src}/${entry}.css`],
			define: {
				__DOJO_SCOPE: '"dev"'
			},
			loader: {
				'.png': 'file',
				'.jpg': 'file',
				'.gif': 'file',
				'.svg': 'file',
				'.ttf': 'file',
				'.woff2': 'file',
				'.woff': 'file',
				'.otf': 'file',
				'.eot': 'file',
				'.ico': 'file'
			},
			plugins: [hasPlugin, cssPlugin]
		});
	} catch (e) {}
	let index = fs.readFileSync(`./${src}/${html}.html`, 'utf-8');
	index = index.replace(
		'</head>',
		`<link rel='stylesheet' href='./${entry}.css'>
</head>`
	);
	index = index.replace(
		'</body>',
		`<script async src='./${entry}.js'></script>
</body>`
	);
	fs.writeFileSync(`./${output}/${entry}.css`, cssPlugin.output());
	fs.writeFileSync(`./${output}/${html}.html`, index);
};

export const watch = async () => {
	await build();
	await watcher.subscribe(`${process.cwd()}/src`, async (err: any, events: any) => {
		build();
	});
};

export const compiler = () => {
	const dones: any[] = [];
	const invalids: any[] = [];
	invalids.forEach((invalid) => invalid());
	build().then(() => {
		dones.forEach((done) => done({ toJson: () => ({ modules: [] }) }));
		watcher.subscribe(`${process.cwd()}/src`, async (err: any, events: any) => {
			invalids.forEach((invalid) => invalid());
			await build();
			dones.forEach((done) => done({ toJson: () => ({ modules: [] }) }));
		});
	});
	return {
		hooks: {
			done: {
				tap(name: string, callback: Function) {
					dones.push(callback);
				}
			},
			invalid: {
				tap(name: string, callback: Function) {
					invalids.push(callback);
				}
			}
		}
	};
};