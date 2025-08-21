# pennsieve-visualization

## Project setup
```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Compiles and minifies for production
```
npm run build
```


# Vue 3 + Vite
Uses Vite with Vue 3

# Use in Application
```
npm i pennsieve-visualization@latest
```

## Import Styles in main.js
```
import 'pennsieve-visualization/style.css'
```

## Import Library
```
import {UMAP, DataExplorer} from "pennsieve-visualization"
```

## Props
add property of apiUrl that matches your environment variable for the domain
```
<UMAP :apiUrl="config.apiUrl"/>
<DataExplorer :apiUrl="config.apiUrl"/>
```