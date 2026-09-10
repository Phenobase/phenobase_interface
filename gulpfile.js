const gulp = require('gulp');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { series, src, dest } = gulp;

// Custom clean function using fs and path
function clean(cb) {
    const directory = './public';

    // Check if directory exists
    if (fs.existsSync(directory)) {
        // Recursively remove directory
        removeDirectory(directory);
    }

    cb(); // Callback to indicate completion
}

// Recursive function to remove directory
function removeDirectory(directory) {
    fs.readdirSync(directory).forEach((file) => {
        const filePath = path.join(directory, file);
        if (fs.lstatSync(filePath).isDirectory()) {
            removeDirectory(filePath);
        } else {
            fs.unlinkSync(filePath);
        }
    });
    fs.rmdirSync(directory);
}

function copyApp() {
    return src('app/**/*', { encoding: false })
        .pipe(dest('public/'));
}

function syncCitationData(cb) {
    const outputPath = path.join(__dirname, 'app', 'source-citations-data.js');
    const phenobaseDataDir = path.resolve(
        __dirname,
        process.env.PHENOBASE_DATA_DIR || '../phenobase_data'
    );
    const exporterPath = path.join(phenobaseDataDir, 'export_interface_source_citations.py');

    if (process.env.PHENOBASE_SKIP_CITATION_SYNC === '1') {
        console.log('Skipping citation sync because PHENOBASE_SKIP_CITATION_SYNC=1.');
        cb();
        return;
    }

    if (!fs.existsSync(exporterPath)) {
        if (!fs.existsSync(outputPath)) {
            cb(new Error(`Missing ${outputPath}; cannot build citation data without ${exporterPath}.`));
            return;
        }
        console.log(`Skipping citation sync; ${exporterPath} was not found. Using checked-in app/source-citations-data.js.`);
        cb();
        return;
    }

    const result = spawnSync(
        process.env.PYTHON || 'python3',
        [exporterPath, '--output', outputPath],
        {
            cwd: phenobaseDataDir,
            stdio: 'inherit',
        }
    );

    if (result.error) {
        cb(result.error);
        return;
    }
    if (result.status !== 0) {
        cb(new Error(`Citation sync failed with exit code ${result.status}.`));
        return;
    }
    cb();
}

function copyOptionalTraitVizLib(cb) {
    const traitVizLib = 'app/trait-viz/lib';

    if (!fs.existsSync(traitVizLib)) {
        cb();
        return;
    }

    src(`${traitVizLib}/**/*`, { encoding: false })
        .pipe(dest('public/trait-viz/lib/'))
        .on('end', cb)
        .on('error', cb);
}

// Register tasks
exports.clean = clean;
exports.syncCitationData = syncCitationData;
exports.default = series(syncCitationData, copyApp, copyOptionalTraitVizLib);
exports.build = series(clean, syncCitationData, copyApp, copyOptionalTraitVizLib);
