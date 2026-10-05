const key='flightlog-token', cleared='flightlog-disconnected';
export function connectionToken(){
    const launch=new URLSearchParams(location.hash.slice(1)).get('token');
    if(location.hash)history.replaceState(null,'',location.pathname+location.search);
    if(launch)return launch.trim();
    try{return localStorage.getItem(key)||(!localStorage.getItem(cleared)?sessionStorage.getItem(key):'')||'';}catch{return '';}
}
// Persist only after the backend has accepted the credential.
export function rememberConnection(token){
    try{if(localStorage.getItem(key)!==token)localStorage.setItem(key,token);localStorage.removeItem(cleared);sessionStorage.removeItem(key);}catch{/* Storage may be unavailable in a restricted browser. */}
}
export function forgetConnection(){
    try{sessionStorage.removeItem(key);localStorage.setItem(cleared,'1');localStorage.removeItem(key);}catch{}
}
export function rejectConnection(token){
    try{if(localStorage.getItem(key)===token)forgetConnection();sessionStorage.removeItem(key);}catch{}
}
addEventListener('storage',event=>{
    if(event.key===key||event.key===cleared){try{sessionStorage.removeItem(key);}catch{}location.reload();}
});
