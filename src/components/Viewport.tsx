import * as Phaser from 'phaser'
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { SceneNames } from '../../enum'
import LoadingScene from './scenes/LoadingScene'
import IntroScene from './scenes/IntroScene'
import MapScene from './scenes/MapScene'
import Scene3D from '../render3d/Scene3D'

// Two engines, one game. Phaser runs the whole simulation but draws nothing — HEADLESS gives it no
// renderer and no canvas at all, while its loader, arcade physics, timers and scene update loop all
// still run exactly as before. Three.js owns everything visible (see render3d/Scene3D), reading the
// simulation's state each frame.
//
// Keeping Phaser rather than reimplementing the sim on top of Three.js is deliberate: collision
// detection, projectile flight, production timers and the AI are all renderer-independent and already
// correct. Rewriting them to drop one dependency would risk a working game to change nothing the player
// can see.
export default () => {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const game = new Phaser.Game({
            type: Phaser.HEADLESS,
            width: 1, height: 1,
            // HEADLESS still wants a parent to attach its (unused) DOM node to; it must not be the
            // container Three.js is rendering into.
            parent: undefined,
            physics: {
                default: 'arcade',
                arcade: { debug: false },
            },
            // No renderer means no requestAnimationFrame driven by the browser's compositor, so the
            // simulation is stepped on a fixed timer instead. 60fps to match what the physics tuning
            // (speeds in px/s, cooldowns in ms) was balanced against.
            fps: { target: 60, forceSetTimeOut: true },
            audio: { noAudio: true },
            scene: [
                new LoadingScene({ key: SceneNames.Loading }),
                new IntroScene({ key: SceneNames.Intro }),
                new MapScene({ key: SceneNames.Main }),
            ],
        })

        const view = new Scene3D(containerRef.current)

        return () => {
            view.dispose()
            game.destroy(true)
        }
    }, [])

    return <div ref={containerRef} style={{ width:'100vw', height:'100vh', position:'relative' }}/>
}
