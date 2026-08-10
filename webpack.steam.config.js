const path = require('path')
const merge = require('webpack-merge')
const common = require('./webpack.base.config')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const { DefinePlugin } = require('webpack')

const prod = {
  mode: 'production',
  target: 'electron-renderer',
  output: {
      path: path.join(__dirname, './bin/src/build/'),
      filename: 'bundle.js',
      publicPath: './'
  },
  plugins: [
    new CleanWebpackPlugin({ cleanOnceBeforeBuildPatterns: [path.resolve(__dirname, './bin/src/build/')] }),
    new DefinePlugin({
      'steam': JSON.stringify('true')
    })
  ]
}

module.exports = merge.merge(common, prod)