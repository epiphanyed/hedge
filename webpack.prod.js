const common = require('./webpack.common.js')
const htmlexport = require('./webpack.htmlexport')
const { merge } = require('webpack-merge')
const path = require('path')
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin')
const { EsbuildPlugin } = require('esbuild-loader')

module.exports = [
  merge(common, {
    mode: 'production',
    output: {
      path: path.join(__dirname, 'public/build'),
      publicPath: 'build/',
      filename: '[name].[contenthash].js'
    },
    optimization: {
      minimizer: [
        new EsbuildPlugin({
          target: 'es2015',
          format: 'cjs',
          exclude: ['MathJax/extensions/a11y/mathmaps', 'reveal.js/plugin/markdown/marked.js']
        })
      ],
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor3d: {
            test: /[\\/]node_modules[\\/](three|@types\/three)[\\/]/,
            name: 'vendor-3d',
            chunks: 'async',
            priority: 30,
            enforce: true
          },
          vendorChem: {
            test: /[\\/]node_modules[\\/](3dmol|3dmol-min)[\\/]/,
            name: 'vendor-chem',
            chunks: 'async',
            priority: 30,
            enforce: true
          },
          vendorInk: {
            test: /[\\/]node_modules[\\/]perfect-freehand[\\/]/,
            name: 'vendor-ink',
            chunks: 'async',
            priority: 25,
            enforce: true
          },
          vendorMathPreview: {
            test: /[\\/]node_modules[\\/]katex[\\/]/,
            name: 'vendor-math-preview',
            chunks: 'async',
            priority: 25,
            enforce: true
          }
        }
      }
    },
    devtool: 'source-map'
  }),
  merge(htmlexport, {
    mode: 'production',
    optimization: {
      minimizer: [
        new EsbuildPlugin({
          target: 'es2015',
          format: 'cjs'
        }),
        new OptimizeCSSAssetsPlugin({})
      ]
    }
  })]
