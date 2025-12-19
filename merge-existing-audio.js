#!/usr/bin/env node

const { mergeAllOutputs } = require('./merge_audio');
const path = require('path');
const fs = require('fs');

// Get the outputs directory
const outputsDir = path.join(__dirname, 'outputs');

console.log('🎵 Manual Audio Merger');
console.log('=====================');

// Check if outputs directory exists
if (!fs.existsSync(outputsDir)) {
  console.log('❌ No outputs directory found');
  process.exit(1);
}

// List all journey directories
const journeyDirs = fs.readdirSync(outputsDir)
  .filter(dir => fs.statSync(path.join(outputsDir, dir)).isDirectory());

if (journeyDirs.length === 0) {
  console.log('❌ No journey directories found in outputs/');
  process.exit(1);
}

console.log(`📁 Found ${journeyDirs.length} journey(s):`);
journeyDirs.forEach((dir, i) => {
  console.log(`   ${i + 1}. ${dir}`);
});

// Get command line argument for which journey to merge
const args = process.argv.slice(2);
let targetJourney = null;

if (args.length > 0) {
  const journeyIndex = parseInt(args[0]) - 1;
  if (journeyIndex >= 0 && journeyIndex < journeyDirs.length) {
    targetJourney = journeyDirs[journeyIndex];
  } else {
    // Try to find by name
    targetJourney = journeyDirs.find(dir => 
      dir.toLowerCase().includes(args[0].toLowerCase())
    );
  }
}

if (!targetJourney) {
  console.log('\n❓ Usage:');
  console.log('   node merge-existing-audio.js [journey_number_or_name]');
  console.log('\n   Examples:');
  console.log('   node merge-existing-audio.js 1');
  console.log('   node merge-existing-audio.js "Episode_1"');
  console.log('   node merge-existing-audio.js all');
  process.exit(1);
}

async function mergeJourney(journeyName) {
  const journeyPath = path.join(outputsDir, journeyName);
  
  console.log(`\n🔄 Processing: ${journeyName}`);
  
  // Check for audio files
  const outputDirs = fs.readdirSync(journeyPath)
    .filter(dir => dir.startsWith('Output-'))
    .map(dir => path.join(journeyPath, dir));
  
  if (outputDirs.length === 0) {
    console.log('   ❌ No Output directories found');
    return;
  }
  
  let hasAudioFiles = false;
  outputDirs.forEach(dir => {
    const audioFiles = fs.readdirSync(dir).filter(f => f.endsWith('.mp3'));
    if (audioFiles.length > 0) {
      console.log(`   📄 Found ${audioFiles.length} audio files in ${path.basename(dir)}`);
      hasAudioFiles = true;
    }
  });
  
  if (!hasAudioFiles) {
    console.log('   ❌ No audio files found to merge');
    return;
  }
  
  try {
    console.log('   🎵 Starting merge...');
    mergeAllOutputs(journeyPath);
    console.log('   ✅ Merge completed successfully!');
    
    // Show merged file location
    const mergedFiles = outputDirs
      .map(dir => path.join(dir, 'merged.mp3'))
      .filter(file => fs.existsSync(file));
    
    if (mergedFiles.length > 0) {
      console.log('   📁 Merged files created:');
      mergedFiles.forEach(file => {
        const stats = fs.statSync(file);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`      ${file} (${sizeMB} MB)`);
      });
    }
    
  } catch (error) {
    console.log(`   ❌ Merge failed: ${error.message}`);
  }
}

async function main() {
  if (args[0] === 'all') {
    console.log('\n🔄 Merging all journeys...');
    for (const journey of journeyDirs) {
      await mergeJourney(journey);
    }
  } else {
    await mergeJourney(targetJourney);
  }
  
  console.log('\n🎉 Done!');
}

main().catch(console.error);