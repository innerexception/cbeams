import * as Phaser from 'phaser'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { SceneNames } from '../../enum';
import LoadingScene from './scenes/LoadingScene';
import IntroScene from './scenes/IntroScene';
import MapScene from './scenes/MapScene';

export default () => {
    const containerRef = useRef(null)
    const componentDidMount = () => {
        new Phaser.Game({
            type: Phaser.WEBGL,
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

    return <div ref={containerRef} id='canvasEl' style={{width:'800px', height:'600px', border:'2px solid white'}}/>
}



