const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'electron-builder.config.js');
const config = require(configPath);
const sourceDir = config.directories.output;
const targetDir = path.join(rootDir, 'dist');
const packageJson = require(path.join(rootDir, 'package.json'));
const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');
const artifacts = [
  `Inkwell Setup ${packageJson.version}.exe`,
  `Inkwell Setup ${packageJson.version}.exe.blockmap`,
  'latest.yml'
];

execFileSync(process.execPath, [electronBuilderCli, '--config', 'electron-builder.config.js', '--win', '--x64'], {
  cwd: rootDir,
  stdio: 'inherit'
});

fs.mkdirSync(targetDir, { recursive: true });

for (const artifact of artifacts) {
  const sourcePath = path.join(sourceDir, artifact);
  const targetPath = path.join(targetDir, artifact);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

console.log(`Copied release artifacts to ${targetDir}`);