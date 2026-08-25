import * as Phaser from 'phaser'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { SceneNames } from '../../enum';
import LoadingScene from './scenes/LoadingScene';
import IntroScene from './scenes/IntroScene';
import MapScene from './scenes/MapScene';

const columnTop = require('../assets/img/column-top.png')
const columnMid = require('../assets/img/column-mid.png')
const columnBottom = require('../assets/img/column-bottom.png')
const base = require('../assets/img/base.png')
const baseLeft = require('../assets/img/base-l.png')
const ceiling = require('../assets/img/ceiling.png')
const ceilingLeft = require('../assets/img/ceiling-l.png')
const decal = require('../assets/img/decal1-1.png')
const decal2 = require('../assets/img/decal2.png')
const COLUMN_TILE_PX = 32
const COLUMN_RENDER_PX = COLUMN_TILE_PX * 2

const ColumnBorder = ({ side }: { side: 'left' | 'right' }) => (
    <div style={{
        position: 'absolute', top: COLUMN_RENDER_PX, bottom: COLUMN_RENDER_PX, [side]: 0, width: COLUMN_RENDER_PX, zIndex: 10,
        backgroundImage: `url(${columnTop}), url(${columnBottom}), url(${columnMid})`,
        backgroundRepeat: 'no-repeat, no-repeat, repeat-y',
        backgroundPosition: 'top, bottom, top',
        backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
    }} />
)

// A horizontal strip along the viewport's top or bottom edge, split straight down the middle — leftImage
// tiles the left half, rightImage tiles the right half, both at the same render scale as everything else
// here. Base and Ceiling are both just this, mirrored: Base is bottom/base-l.png/base.png, Ceiling is
// top/ceiling-l.png/ceiling.png.
const EdgeStrip = ({ edge, leftImage, rightImage }: { edge: 'top' | 'bottom', leftImage: string, rightImage: string }) => (
    <>
        <div style={{
            position: 'absolute', left: 0, width: '50%', [edge]: 0, height: COLUMN_RENDER_PX, zIndex: 10,
            backgroundImage: `url(${leftImage})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: edge,
            backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
            imageRendering: 'pixelated',
            pointerEvents: 'none',
        }} />
        <div style={{
            position: 'absolute', right: 0, width: '50%', [edge]: 0, height: COLUMN_RENDER_PX, zIndex: 10,
            backgroundImage: `url(${rightImage})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: edge,
            backgroundSize: `${COLUMN_RENDER_PX}px ${COLUMN_RENDER_PX}px`,
            imageRendering: 'pixelated',
            pointerEvents: 'none',
        }} />
    </>
)

export default () => {
    const containerRef = useRef(null)
    const componentDidMount = () => {
        new Phaser.Game({
            type: Phaser.AUTO,
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
            parent: 'canvasEl',
            physics: {
                default: 'arcade',
                arcade: {
                    debug: false,
                }
            },
            render: {
                pixelArt: true
            },
            scene: [
                new LoadingScene({key: SceneNames.Loading}),
                new IntroScene({key: SceneNames.Intro}),
                new MapScene({key: SceneNames.Main})
            ]
        })
    }
    React.useEffect(componentDidMount, [])

    return (
        <div style={{ position:'relative', width:'100vw', height:'100vh' }}>
            <div ref={containerRef} id='canvasEl' style={{width:'100vw', height:'100vh'}}/>
            <ColumnBorder side='left' />
            <ColumnBorder side='right' />
            <EdgeStrip edge='bottom' leftImage={baseLeft} rightImage={base} />
            <EdgeStrip edge='top' leftImage={ceilingLeft} rightImage={ceiling} />
            <div style={{pointerEvents:'none', position:'absolute', backgroundSize:'contain', bottom:0, left:-100, zIndex:12, backgroundImage:'url('+decal+')', width:'348px', height:'456px'}}/>
            <div style={{pointerEvents:'none', position:'absolute', backgroundSize:'contain', bottom:-55, right:-50, zIndex:12, backgroundImage:'url('+decal2+')', width:'282px', height:'356px'}}/>
        </div>
    )
}



