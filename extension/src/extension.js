const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let runningProcess = null;
let webviewPanel = null;

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('cdrca.createProject', createProject),
    vscode.commands.registerCommand('cdrca.runFile', runFile),
    vscode.commands.registerCommand('cdrca.stopFile', stopFile)
  );
}

function deactivate() {
  stopFile();
}

// --- CDRCA: Create New Project ---
// Thin wrapper over `cdrca create app` — scaffolding logic lives in the CLI,
// not duplicated here. Mirrors Flutter's "Flutter: New Project" Command
// Palette flow: pick a parent folder, then a name, then scaffold there and
// open the result — rather than silently using whatever folder happens to
// already be open as the workspace.
async function createProject() {
  const folderPick = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Folder for New Project'
  });
  if (!folderPick || folderPick.length === 0) return;
  const parentDir = folderPick[0].fsPath;

  const name = await vscode.window.showInputBox({
    prompt: 'CDRCA project name',
    placeHolder: 'my-cdrca-app',
    validateInput: (value) => (value && value.trim().length > 0 ? null : 'Name cannot be empty')
  });
  if (!name) return;

  const projectPath = path.join(parentDir, name);
  if (fs.existsSync(projectPath)) {
    vscode.window.showErrorMessage(`A folder named '${name}' already exists in ${parentDir}.`);
    return;
  }

  // Spawned directly via child_process — NOT a terminal + sendText. This is
  // a genuinely separate path from a user typing 'cdrca create app <name>'
  // themselves; it doesn't touch or depend on any terminal at all.
  const outputChannel = vscode.window.createOutputChannel('CDRCA');
  outputChannel.show(true);

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating CDRCA project '${name}'...` },
    () => new Promise((resolve) => {
      const proc = spawn('cdrca', ['create', 'app', name], { cwd: parentDir, shell: true });

      proc.stdout.on('data', (data) => outputChannel.append(data.toString()));
      proc.stderr.on('data', (data) => outputChannel.append(data.toString()));

      proc.on('exit', (code) => resolve(code === 0));
      proc.on('error', (err) => {
        outputChannel.append(`Failed to launch cdrca: ${err.message}\n`);
        resolve(false);
      });
    })
  );

  if (!result) {
    vscode.window.showErrorMessage(
      `'cdrca create app ${name}' failed — see the CDRCA output channel for details.`
    );
    return;
  }

  vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), { forceNewWindow: false });
}

// --- CDRCA: Run ---
// Requires CDRCA to already be installed — this extension never installs
// the language itself. Spawns the actual installed `cdrca` binary (the one
// the Windows installer puts on PATH) via `cdrca run` — NOT npx/npm, which
// would contradict the whole "no npm in the toolchain" decision. `cdrca run`
// picks its own free port and prints it as `CDRCA_PORT=<port>` on stdout, so
// two projects running at once (or that port being busy for any other
// reason) can't silently collide the way a hardcoded port would.
async function runFile(uri) {
  const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    vscode.window.showErrorMessage('No .cdrca file is open.');
    return;
  }

  const projectRoot = findProjectRoot(targetUri.fsPath);
  if (!projectRoot) {
    vscode.window.showErrorMessage(
      "No cdrca.json found — CDRCA's run button only works inside a CDRCA project."
    );
    return;
  }

  if (runningProcess) {
    vscode.window.showInformationMessage('A CDRCA run is already active. Stop it first.');
    return;
  }

  let resolvePort, rejectPort;
  const portPromise = new Promise((res, rej) => { resolvePort = res; rejectPort = rej; });
  let portResolved = false;

  runningProcess = spawn('cdrca', ['run'], { cwd: projectRoot, shell: true });

  runningProcess.stdout.on('data', (data) => {
    const match = data.toString().match(/CDRCA_PORT=(\d+)/);
    if (match && !portResolved) {
      portResolved = true;
      resolvePort(parseInt(match[1], 10));
    }
  });

  runningProcess.on('exit', () => {
    runningProcess = null;
    if (!portResolved) rejectPort(new Error('cdrca run exited before reporting a port'));
  });
  runningProcess.on('error', (err) => {
    vscode.window.showErrorMessage(`Failed to launch CDRCA (is the CLI installed and on PATH?): ${err.message}`);
    runningProcess = null;
    if (!portResolved) rejectPort(err);
  });

  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Starting CDRCA...' },
    async () => {
      let port;
      try {
        port = await portPromise;
      } catch (e) {
        return false;
      }
      return waitForServer(port, 15000).then((ready) => ready && port);
    }
  ).then((result) => {
    if (!result) {
      vscode.window.showErrorMessage('CDRCA server did not become ready in time.');
      stopFile();
      return;
    }
    openWebview(result, path.basename(projectRoot));
  });
}

function stopFile() {
  if (runningProcess) {
    runningProcess.kill();
    runningProcess = null;
  }
  if (webviewPanel) {
    webviewPanel.dispose();
    webviewPanel = null;
  }
}

function openWebview(port, projectName) {
  webviewPanel = vscode.window.createWebviewPanel(
    'cdrcaPreview',
    `CDRCA: ${projectName}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );
  webviewPanel.webview.html = `<html><body style="margin:0"><iframe src="http://127.0.0.1:${port}" style="border:0;width:100%;height:100vh;"></iframe></body></html>`;
  webviewPanel.onDidDispose(() => {
    webviewPanel = null;
  });
}

function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, timeout: 500 }, (res) => {
        res.destroy();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tryOnce, 300);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

function findProjectRoot(startPath) {
  let dir = path.dirname(startPath);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'cdrca.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

module.exports = { activate, deactivate };
