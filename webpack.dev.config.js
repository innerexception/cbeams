const merge = require('webpack-merge')
const common = require('./webpack.base.config')

const dev = {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    open: false,
    historyApiFallback: true
  },
  optimization: {
    nodeEnv: 'development'
  },
}

module.exports = merge.merge(common, dev)