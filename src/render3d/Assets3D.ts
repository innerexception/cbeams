import * as THREE from 'three'
import { ShipType } from '../../enum'
import { resources } from '../assets/Assets'

// Texture plumbing for the Three.js renderer. Everything is cached per key — a Texture is a GPU upload,
// so building one per sprite instance instead of per distinct image would be pure waste.

const urlByKey = new Map<string, string>()
resources.forEach(r => { if(r.type === 'image' || r.type === 'spritesheet') urlByKey.set(r.key, r.resource) })

const applyPixelArtFilter = (tex:THREE.Texture) => {
    // The art is small hand-drawn pixel work — smoothing it into mush on magnification would throw away
    // the entire look (Phaser was configured with pixelArt:true for the same reason).
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

const loader = new THREE.TextureLoader()
const plainCache = new Map<string, THREE.Texture>()
export const getTexture = (key:string) => {
    let tex = plainCache.get(key)
    if(tex) return tex
    tex = applyPixelArtFilter(loader.load(urlByKey.get(key)))
    plainCache.set(key, tex)
    return tex
}

// An exact palette swap of hull green for red, baked into a real texture — NOT a multiplicative tint.
// Every ship's art uses more than one palette color (black outline, green hull, yellow highlight), and
// multiplying a red tint through that produces off-palette blends (green*red is a muddy olive, not red)
// rather than a clean recolor. This is the same swap MapScene's generateHostileShipTexture did for Phaser.
// The source image may not have decoded yet when this is first called, so the canvas is filled in on load
// and the texture flagged for re-upload then.
const HULL = { r:0x55, g:0xff, b:0x55 }
const ENEMY = { r:0xff, g:0x55, b:0x55 }
const enemyCache = new Map<string, THREE.Texture>()
export const getEnemyTexture = (key:string) => {
    let tex = enemyCache.get(key)
    if(tex) return tex

    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    tex = applyPixelArtFilter(new THREE.CanvasTexture(canvas))
    enemyCache.set(key, tex)

    const image = new Image()
    image.onload = () => {
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        for(let i=0; i<data.length; i+=4){
            if(data[i+3] === 0) continue
            if(data[i] === HULL.r && data[i+1] === HULL.g && data[i+2] === HULL.b){
                data[i] = ENEMY.r; data[i+1] = ENEMY.g; data[i+2] = ENEMY.b
            }
        }
        ctx.putImageData(imageData, 0, 0)
        tex.needsUpdate = true
    }
    image.src = urlByKey.get(key)
    return tex
}

// CATH has its own bespoke enemy art rather than a recolor of the player's, same as in the 2D renderer.
export const getShipTexture = (type:ShipType, isEnemy:boolean) => {
    if(!isEnemy) return getTexture(type)
    return type === ShipType.CATH ? getTexture('base_enemy') : getEnemyTexture(type)
}

// tiles.png is a 13x13 grid of 32px frames (see enum.ts's ObjectiveSpriteIndex / AsteroidSpriteIndexes*).
// UV offset/repeat live on the Texture object itself, so every distinct frame needs its own clone —
// sharing one Texture across sprites wanting different frames would show them all whichever frame was
// configured last.
const TILE_COLS = 13
const tileCache = new Map<number, THREE.Texture>()
export const getTileTexture = (frameIndex:number) => {
    let tex = tileCache.get(frameIndex)
    if(tex) return tex
    tex = getTexture('tiles').clone()
    applyPixelArtFilter(tex)
    tex.needsUpdate = true
    const col = frameIndex % TILE_COLS, row = Math.floor(frameIndex / TILE_COLS)
    tex.offset.set(col/TILE_COLS, 1 - (row+1)/TILE_COLS)
    tex.repeat.set(1/TILE_COLS, 1/TILE_COLS)
    tileCache.set(frameIndex, tex)
    return tex
}

// A single flat white pixel every solid-colored billboard (bars, dots, boxes) shares, tinted per-instance
// via material color and sized via scale — none of those need their own image asset.
export const whiteTexture = (() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
    return new THREE.CanvasTexture(canvas)
})()

export const makeQuad = (color:number, opacity = 1) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:whiteTexture, color, transparent:true, opacity, depthTest:false }))
    sprite.renderOrder = 10
    return sprite
}

// A canvas-backed text billboard. Re-rasterizes only when the string actually changes — ammo counts and
// unit labels are stable across most frames, so redrawing every frame would be wasted canvas work.
export interface TextSprite {
    sprite: THREE.Sprite
    setText: (text:string, color:string, worldHeight?:number) => void
    dispose: () => void
}
export const makeTextSprite = ():TextSprite => {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 64
    const ctx = canvas.getContext('2d')
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    const material = new THREE.SpriteMaterial({ map:texture, transparent:true, depthTest:false })
    const sprite = new THREE.Sprite(material)
    sprite.renderOrder = 20

    let lastText = '', lastColor = '', lastHeight = 0
    const setText = (text:string, color:string, worldHeight = 12) => {
        if(text === lastText && color === lastColor && worldHeight === lastHeight) return
        lastText = text; lastColor = color; lastHeight = worldHeight
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.font = 'bold 40px monospace'
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, canvas.width/2, canvas.height/2)
        texture.needsUpdate = true
        const aspect = Math.max(1, ctx.measureText(text).width / 40)
        sprite.scale.set(worldHeight * aspect * 1.05, worldHeight, 1)
    }

    return { sprite, setText, dispose: () => { texture.dispose(); material.dispose() } }
}
