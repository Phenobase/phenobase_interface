# About
[![Netlify Status](https://api.netlify.com/api/v1/badges/db775c45-a020-414c-9bba-539bf5de3fcf/deploy-status)](https://app.netlify.com/projects/phenobase2/deploys)

A lightweight interface for visualizing plant phenology, drawing on data that has been indexed using the script at
[phenobase_data](https://github.com/Phenobase/phenobase_data).  This interface is written
in angularJS v1.7 and bootstrap v3.x and calls ElasticSearch via [biscicol-server](https://github.com/biscicol/biscicol-server)

The master branch of this repository is hosted on netlify and currently running at: https://phenobase.netlify.app/

# first time installation steps
```

// first ensure you have the correct versions
$ node -v
v18.2.0
$ npm -v
8.9.0

# git checkout main codebase
# git checkout trait-viz submodule
$ cd app
$ git submodule add https://github.com/biocodellc/trait-viz.git
$ git commit -am "add trait-viz submodule"

npm install 
```

# to run on a local server
```
npm start 
```

# deployment 
The following uses `public/` as the output directory:
```
gulp clean
gulp   
```

# Serving on the Web

1. Just point Apache or Nginx to the `public/` directory after running gulp
2. Netlify: deploy build command, use `gulp` and point to directory `public`

