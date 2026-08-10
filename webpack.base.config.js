const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  entry: './index.tsx',
  output: {
    path: path.resolve(__dirname, './public'),
    filename: '[name].bundle.js',
    chunkFilename: '[name].chunk.js'
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js']
  },
  module: {
    rules: [
        { test: /\.tsx?$/, include: path.join(__dirname, './'), loader: 'ts-loader' },
        {
            test: /\.css$/,
            use: [{
                    loader: "style-loader"
                },
                {
                    loader: "css-loader"
                }
            ]
        },
        {
          test: /\.(png|jpg|gif|jpeg|wav|mp3)$/,
          type: 'asset/resource'
        },
        { 
          test: /\.(eot|ttf|woff|otf)$/, 
          type: 'asset'
        }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({ template: './public/index.html' })
  ]
}