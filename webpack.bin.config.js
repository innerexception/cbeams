const path = require('path')
const merge = require('webpack-merge')
const common = require('./webpack.base.config')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')

const prod ={
  mode: 'production',
  target: 'electron-renderer',
  output: {
      path: path.join(__dirname, './electron/src/build/'),
      filename: 'bundle.js',
      publicPath: './'
  },
  plugins: [
    new CleanWebpackPlugin({ cleanOnceBeforeBuildPatterns: [path.resolve(__dirname, './electron/src/build/')] }),
  ]
}

module.exports = merge.merge(common, prod)