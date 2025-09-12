const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FFMPEG_PATH = "C:\\ffmpeg-master-latest-win64-gpl-shared\\bin\\ffmpeg.exe";

// Requires ffmpeg installed and in PATH
function mergeAudiosInOrder(outputDir, outFile) {
  // Get all *_lineN.mp3 files and sort strictly by N (numeric order)
  const files = fs.readdirSync(outputDir)
    .filter(f => /_line\d+\.mp3$/.test(f))
    .sort((a, b) => {
      const getNum = s => parseInt(s.match(/line(\d+)/)?.[1] || '0', 10);
      return getNum(a) - getNum(b);
    });
  if (files.length === 0) {
    console.log(`[merge] No mp3 files in ${outputDir}`);
    return;
  }
  // Write file list for ffmpeg in strict numeric order
  const listPath = path.join(outputDir, 'merge_list.txt');
  fs.writeFileSync(listPath, files.map(f => `file '${f}'`).join('\n'));
  // Merge with ffmpeg
  const cmd = `${FFMPEG_PATH} -y -f concat -safe 0 -i "${listPath}" -c copy "${outFile}"`;
  console.log(`[merge] Merging ${files.length} files in ${outputDir} to ${outFile}`);
  execSync(cmd, { cwd: outputDir, stdio: 'inherit' });
  fs.unlinkSync(listPath);
}

function mergeAllOutputs(baseDir = path.join(__dirname, 'outputs')) {
  const outputDirs = fs.readdirSync(baseDir)
    .filter(f => f.startsWith('Output-'))
    .map(f => path.join(baseDir, f));
  outputDirs.forEach(dir => {
    const outFile = path.join(dir, 'merged.mp3');
    mergeAudiosInOrder(dir, outFile);
  });
}

if (require.main === module) {
  mergeAllOutputs();
}

module.exports = {
  mergeAllOutputs,
  getMergedAudioFiles: function(baseDir = path.join(__dirname, 'outputs')) {
    const outputDirs = fs.readdirSync(baseDir)
      .filter(f => f.startsWith('Output-'))
      .map(f => path.join(baseDir, f));
    return outputDirs.map(dir => ({
      dir,
      mergedPath: path.join(dir, 'merged.mp3'),
      journeyName: path.basename(dir)
    }));
  }
};
