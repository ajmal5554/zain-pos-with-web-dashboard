import React,{useState} from 'react';
import {seasonAlerts} from '../lib/forecastSeasons';
import type {SeasonReminder} from '../lib/forecastSeasons';
import {shiftDay} from '../lib/salesOutlook';
import {Modal} from './ui/Modal';
import {ConfirmDialog} from './ui/ConfirmDialog';
import {showToast} from './ui/Toast';
export const ForecastSeasons:React.FC<{today:string;horizon:number;userId:string}>=({today,horizon,userId})=>{
    const key=`forecast-seasons-v1:${userId}`;
    const [custom,setCustom]=useState<SeasonReminder[]>(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(saved)?saved.filter(r=>typeof r.id==='string'&&typeof r.name==='string'&&r.name.length<=80&&r.date>=today&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)).slice(0,50):[];}catch{return [];}});
    const [open,setOpen]=useState(false),[name,setName]=useState('Eid / Ramadan'),[date,setDate]=useState(''),[remove,setRemove]=useState<string|null>(null);
    function save(rows:SeasonReminder[]){try{localStorage.setItem(key,JSON.stringify(rows));setCustom(rows);return true;}catch{showToast('Could not save planning dates on this device.','error');return false;}}
    function add(){if(!name.trim()||name.length>80||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<today){showToast('Enter a season name and a valid upcoming date.','error');return;}if(custom.length>=50){showToast('Remove an older reminder before adding another.','error');return;}if(save([...custom,{id:crypto.randomUUID(),name:name.trim(),date}])){setOpen(false);showToast('Season reminder saved on this device.','success');}}
    const alerts=seasonAlerts(today,horizon,custom);
    return <section className="border rounded-2xl p-5 space-y-4 dark:border-gray-700"><div className="flex justify-between gap-3 flex-wrap"><div><h2 className="font-semibold text-lg">Season alerts & preparation</h2><p className="text-sm text-gray-500">Upcoming selling periods within the selected horizon. Reminders do not automatically increase the forecast.</p></div><button className="text-primary-600" onClick={()=>setOpen(true)}>Add confirmed season date</button></div>
        <div className="grid md:grid-cols-2 gap-3">{alerts.map(a=><div key={a.id} className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-4"><strong>{a.name}</strong><p className="text-sm">{a.start===a.end?a.start:`${a.start.slice(0,7)} to ${a.end.slice(0,7)}`}</p><p className="text-sm mt-2">{a.detail}</p><p className="text-xs text-gray-500 mt-2">{shiftDay(a.start,-42)<=today?'Preparation review is due now.':`Start reviewing by ${shiftDay(a.start,-42)}.`}</p>{a.custom&&<button className="text-sm text-red-600 mt-2" onClick={()=>setRemove(a.id)}>Remove reminder</button>}</div>)}</div>
        <p className="text-sm text-gray-500">Ramadan/Eid and exact Onam/Vishu dates vary or need local confirmation. Add a confirmed date to schedule a specific reminder. Your dates are saved on this device under your login.</p>
        <Modal isOpen={open} onClose={()=>setOpen(false)} title="Add a confirmed season date"><div className="space-y-4"><label className="block">Season / event<input className="border rounded-lg p-2 w-full dark:bg-gray-800" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><label className="block">Confirmed date<input type="date" className="border rounded-lg p-2 w-full dark:bg-gray-800" min={today} value={date} onChange={e=>setDate(e.target.value)}/></label><p className="text-sm text-gray-500">Confirm religious festival dates locally. This reminder does not change sales, stock or predicted demand.</p><button className="bg-primary-600 text-white px-4 py-2 rounded-lg" onClick={add}>Save reminder</button></div></Modal>
        <ConfirmDialog isOpen={!!remove} onClose={()=>setRemove(null)} onConfirm={()=>{if(save(custom.filter(r=>r.id!==remove)))setRemove(null);}} title="Remove season reminder?" message="This removes only your saved reminder on this device." confirmText="Remove" variant="danger"/>
    </section>;
};

