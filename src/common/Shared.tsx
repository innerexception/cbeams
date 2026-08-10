import * as React from 'react'
import AppStyles, { colors } from '../styles/AppStyles'
import Tooltip from 'rc-tooltip'
import { IconIndexes } from '../../enum'
import { iconSheet, UIElements } from '../assets/Assets'

interface ButtonProps {
    disabled?:boolean, handler:Function, text:JSX.Element | string, style?:object, icon?: IconIndexes, disabledTooltip?:JSX.Element, showTooltip?:boolean
}

export const Button = (props:ButtonProps) => 
    <div style={{...AppStyles.buttonOuter, display:'flex', alignItems:'center', justifyContent:"center", position:'relative', margin:'5px', ...props.style}} 
        onClick={props.disabled ? null:()=>props.handler()}>
        <Tooltip mouseEnterDelay={1} overlay={props.disabled && props.disabledTooltip}>
            <div style={{...AppStyles.buttonInner, color: props.disabled ? colors.grey1: colors.black, zIndex:2, opacity: props.disabled ? 0.5 : 1}}>
                {props.icon && <span style={{marginRight:'0.5em'}}><CssIcon noTooltip={!props.showTooltip || props.disabledTooltip ? true:false} icon={props.icon}/></span>}
                {props.text}
            </div>
        </Tooltip>
        <div style={{position:'absolute', left:-8, top:0, width:'16px',backgroundSize:'16px', height:'100%', backgroundImage:'url('+UIElements.btnBgL+')'}}/>
        <div style={{position:'absolute', right:-8, top:0, width:'16px',backgroundSize:'16px', height:'100%', backgroundImage:'url('+UIElements.btnBgR+')'}}/>
        <div style={{position:'absolute', left:0, opacity:0.6, top:0, width:'100%', height:'100%', backgroundImage:'url('+UIElements.decalSmolDark+')', backgroundSize:'120px', backgroundPosition:'right', backgroundRepeat:'no-repeat', mixBlendMode:'darken'}}/>
    </div>

export const ToggleButton = (props:{state:boolean, handler:any, text:JSX.Element | string}) => 
    <div style={{display:'flex', alignItems:'center', marginBottom:'5px'}} onClick={props.handler}>
        <div style={{border:'2px solid '+colors.grey1, marginRight:'10px', width:'32px', height:'32px' }}>
            {props.state && <CssIcon icon={IconIndexes.Cancel} noTooltip={true}/>}
        </div>
        <div>{props.text}</div>
    </div>
    

export const LightButton = (enabled:boolean, handler:any, text:string, tab?:boolean) => 
    <div style={{position:'relative'}}>
        <div onClick={handler} style={{...AppStyles.buttonInner, pointerEvents: enabled ? 'all' : 'none', color: colors.grey2, opacity: enabled ? 1 : 0,
             textAlign:'center', marginBottom: tab ? '-1px' : 0}}>{text}</div>
    </div>
    
export const NumericInput = (props:{value:number, onValueChange:Function, max?:number, min?:number}) => 
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        {LightButton(props.min || props.min===0 ? props.value > props.min:true, ()=>props.onValueChange(props.value-1),'<')}
        <div style={{width:'2em', textAlign:"center"}}>{props.value}</div>
        {LightButton(props.max || props.max===0 ? props.value < props.max:true, ()=>props.onValueChange(props.value+1),'>')}
    </div>

export const Slider = (props:{value:number, onValueChange:Function, max:number, min:number, step?:number}) => 
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        {LightButton(props.min || props.min===0 ? props.value > props.min:true, ()=>props.onValueChange(props.step ? props.value-props.step : props.value-1),'<')}
        <ProgressBar value={props.value} max={props.max} bg={colors.grey2}/>
        {LightButton(props.value < props.max, ()=>props.onValueChange(props.step ? props.value+props.step : props.value+1),'>')}
    </div>

export const Select = (props:{value:any, onValueChange:Function, values: Array<any>, renderValue:JSX.Element | string}) => 
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        {LightButton(props.values.findIndex(v=>v===props.value) > 0, ()=>props.onValueChange(props.values[props.values.findIndex(v=>v===props.value)-1]),'<')}
        <div style={{textAlign:"center", marginLeft:'5px', marginRight:'5px'}}>{props.renderValue}</div>
        {LightButton(props.values.findIndex(v=>v===props.value) < props.values.length-1, ()=>props.onValueChange(props.values[props.values.findIndex(v=>v===props.value)+1]),'>')}
    </div>

export const IconSelect = (props:{value:IconIndexes, onValueChange:Function, values: Array<IconIndexes>}) => 
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        {LightButton(props.values.findIndex(v=>v===props.value) > 0, ()=>props.onValueChange(props.values[props.values.findIndex(v=>v===props.value)-1]),'<')}
        <CssIcon icon={props.value ? props.value : props.values[0]}/>
        {LightButton(props.values.findIndex(v=>v===props.value) < props.values.length-1, ()=>props.onValueChange(props.values[props.values.findIndex(v=>v===props.value)+1]),'>')}
    </div>

export const ProgressBar = (props:{value:number, max:number, bg:string, style?:object}) => 
    <div style={{width:'98px', height:'24px',  position:'relative', padding:'2px', border:'2px solid black', ...props.style }}>
        <div style={{background:props.bg, backgroundSize:'32px', width:Math.round((props.value/props.max)*100)+'%', height:'100%'}}/>
    </div>

export const VerticalProgressBar = (value:number, max:number, bg:string) => 
    <div style={{width:'36px', height:'84px', border:'2px solid white', position:'relative'}}>
        <div style={{background:'url('+bg+')', backgroundSize:'32px', height:Math.round((value/max)*100)+'%', width:'100%',position:"absolute", bottom:'10%'}}/>
    </div>

export const ThinFrame = (props:{children:JSX.Element, background:string, style?:object}) => 
    <div style={{width:'100%', height:'100%', display:'flex', flexDirection:'column', background:props.background, position:'relative', ...props.style}}>
        <div style={{display:'flex'}}>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgTopLeftPR+')', backgroundSize:'contain'}}/>
            <div style={{width:"100%", height:'16px', backgroundImage: 'url('+UIElements.dlgTopPR+')', backgroundSize:'contain'}}/>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgTopRightPR+')', backgroundSize:'contain'}}/>
        </div>
        <div style={{display:'flex', height:'100%'}}>
            <div style={{backgroundImage:'url('+UIElements.dlgLeftPR+')', width:'16px', backgroundSize:'cover'}}/>
            <div style={{width:'100%', background:'transparent'}}>{props.children}</div>
            <div style={{backgroundImage:'url('+UIElements.dlgRightPR+')', width:'16px', backgroundSize:'cover'}}/>
        </div>
        <div style={{display:'flex'}}>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgBottomLeftPR+')', backgroundSize:'contain'}}/>
            <div style={{width:"100%",height:'16px', backgroundImage: 'url('+UIElements.dlgBottomPR+')', backgroundSize:'contain'}}/>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgBottomRightPR+')', backgroundSize:'contain'}}/>
        </div>
    </div>

export const CssIcon = (props:{icon:IconIndexes, noTooltip?:boolean}) => {
    let backgroundImage = 'url('+iconSheet+')'
    let sheetWidth = 10

    return <Tooltip placement='bottom' mouseEnterDelay={0.5} overlay={props.noTooltip ? null : <PaperDialog><div style={{textAlign:'center'}}>{getIconDescription(props.icon)}</div></PaperDialog>}>
            <div style={{
                width:'16px', 
                height: '16px',
                marginLeft:'7px', 
                marginRight:'10px',
                marginTop:'6px',
                backgroundImage, 
                backgroundPosition: -(props.icon % sheetWidth)*16+'px '+-(Math.floor(props.icon/sheetWidth))*16+'px', 
                backgroundRepeat:'no-repeat',
                transform:'scale(2)',
                display:'inline-block'}}/>
        </Tooltip>
} 
     
const getIconDescription = (index:IconIndexes) => {
    switch(index){
        default: return '--'
    }
}

export const Dialog = (props:{children:JSX.Element, background?:string}) => 
<div style={{...AppStyles.window, display:'flex', flexDirection:'column', justifyContent:'space-between'}}>
    <div style={{display:'flex'}}>
        <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgTopLeft+')', backgroundSize:'contain'}}/>
        <div style={{width:"100%", height:'16px', backgroundImage: 'url('+UIElements.dlgTop+')', backgroundSize:'contain'}}/>
        <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgTopRight+')', backgroundSize:'contain'}}/>
    </div>
    <div style={{display:'flex', height:'100%'}}>
        <div style={{backgroundImage:'url('+UIElements.dlgLeft+')', width:'16px', backgroundSize:'contain'}}/>
        <div style={{width:"calc(100% - 32px)", background:props.background}}>{props.children}</div>
        <div style={{backgroundImage:'url('+UIElements.dlgRight+')', width:'16px', backgroundSize:'contain'}}/>
    </div>
    <div style={{display:'flex'}}>
        <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgBottomLeft+')', backgroundSize:'contain'}}/>
        <div style={{width:"100%",height:'16px', backgroundImage: 'url('+UIElements.dlgBottom+')', backgroundSize:'contain'}}/>
        <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgBottomRight+')', backgroundSize:'contain'}}/>
    </div>
</div>

export const PaperDialog = (props:{children:JSX.Element}) => 
    <div style={{width:'100%', background:'transparent'}}>
        <div style={{display:'flex', alignItems:'flex-end'}}>
            <div style={{width:'72px', height:'22px', backgroundImage: 'url('+UIElements.dlgTopLeftP+')', backgroundSize:'contain'}}/>
            <div style={{width:"calc(100% - 134px)", height:'18px', backgroundImage: 'url('+UIElements.dlgTopP+')', backgroundSize:'contain'}}/>
            <div style={{width:'58px', height:'24px', backgroundImage: 'url('+UIElements.dlgTopRightP+')', backgroundSize:'contain'}}/>
        </div>
        <div style={{display:'flex'}}>
            <div style={{backgroundImage:'url('+UIElements.dlgLeftP+')', width:'16px', backgroundSize:'16px', marginLeft:'8px'}}/>
            <div style={{padding:'5px', width:"calc(100% - 32px)", background:colors.white, color:colors.black}}>{props.children}</div>
            <div style={{backgroundImage:'url('+UIElements.dlgRightP+')', width:'16px', backgroundSize:'16px'}}/>
        </div>
        <div style={{display:'flex'}}>
            <div style={{width:'56px', height:'22px', marginLeft:'17px', backgroundImage: 'url('+UIElements.dlgBottomLeftP+')', backgroundSize:'contain'}}/>
            <div style={{width:"calc(100% - 120px)",height:'18px', backgroundImage: 'url('+UIElements.dlgBottomP+')', backgroundSize:'contain'}}/>
            <div style={{width:'46px', height:'22px', backgroundImage: 'url('+UIElements.dlgBottomRightP+')', backgroundSize:'contain'}}/>
        </div>
    </div>

export const ThinDialog = (props:{children:JSX.Element}) => 
    <div style={{background:colors.black}}>
        <div style={{display:'flex'}}>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgTopLeftS+')', backgroundSize:'contain'}}/>
            <div style={{width:"100%", height:'16px', backgroundImage: 'url('+UIElements.dlgTopS+')', backgroundSize:'contain'}}/>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgTopRightS+')', backgroundSize:'contain'}}/>
        </div>
        <div style={{display:'flex'}}>
            <div style={{backgroundImage:'url('+UIElements.dlgLeftS+')', width:'16px', backgroundSize:'cover'}}/>
            <div>{props.children}</div>
            <div style={{backgroundImage:'url('+UIElements.dlgRightS+')', width:'16px', backgroundSize:'cover'}}/>
        </div>
        <div style={{display:'flex'}}>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgBottomLeftS+')', backgroundSize:'contain'}}/>
            <div style={{width:"100%",height:'16px', backgroundImage: 'url('+UIElements.dlgBottomS+')', backgroundSize:'contain'}}/>
            <div style={{width:'16px', height:'16px', backgroundImage: 'url('+UIElements.dlgBottomRightS+')', backgroundSize:'contain'}}/>
        </div>
    </div>