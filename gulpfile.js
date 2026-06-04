const gulp = require('gulp');
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
exports.default = series(copyApp, copyOptionalTraitVizLib);
exports.build = series(clean, copyApp, copyOptionalTraitVizLib);
