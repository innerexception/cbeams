import * as React from 'react'
import * as ReactDOM from 'react-dom'

import './src/styles/app.css'

import AppContainer from './src/AppContainer'
import { FONT_SIZE } from './src/styles/AppStyles'

document.documentElement.style.setProperty('--app-font-size', FONT_SIZE)

ReactDOM.render((
  <AppContainer/>
), document.getElementById('appRoot'))
