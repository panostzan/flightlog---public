export interface Capture { titles:boolean; paths:boolean; searches:boolean; excludedHosts:string[]; }
export interface Page { scheme:string|null; host:string|null; path:string|null; title:string|null; search_provider:string|null; search_query:string|null; status:'allowed'|'excluded'|'unsupported'|'unavailable'; }
export const emptyPage=(status:Page['status']):Page=>({scheme:null,host:null,path:null,title:null,search_provider:null,search_query:null,status});
export function excludedHost(host:string, exclusions:string[]):boolean {
  const h=host.toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
  if(h==='localhost'||h.endsWith('.localhost')||exclusions.some(x=>h===x||h.endsWith('.'+x)))return true;
  if(h.includes(':')) {
    // Conservatively exclude all IPv6 literals in this prototype, including mapped private IPv4.
    return true;
  }
  if(/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a,b]=h.split('.').map(Number);
    return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
  }
  return false;
}
export function filterPage(raw:string|undefined,title:string|undefined,incognito:boolean,c:Capture):Page {
  if(incognito)return emptyPage('excluded');
  let u:URL;try{u=new URL(raw??'');}catch{return emptyPage('unavailable');}
  if(u.protocol!=='http:'&&u.protocol!=='https:')return emptyPage('unsupported');
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(excludedHost(host,c.excludedHosts))return emptyPage('excluded');
  const page:Page={scheme:u.protocol.slice(0,-1),host,path:c.paths?u.pathname.slice(0,2048):null,title:c.titles?(title??'').slice(0,512)||null:null,search_provider:null,search_query:null,status:'allowed'};
  if(c.searches) {
    let provider:string|null=null;
    if(['www.google.com','google.com','www.google.ca','google.ca'].includes(host)&&u.pathname==='/search')provider='google';
    if(['www.bing.com','bing.com'].includes(host)&&u.pathname==='/search')provider='bing';
    if(['duckduckgo.com','www.duckduckgo.com'].includes(host)&&u.pathname==='/')provider='duckduckgo';
    const values=u.searchParams.getAll('q');
    if(provider&&values.length===1&&values[0].length>0){page.search_provider=provider;page.search_query=values[0].slice(0,512);}
  }
  return page;
}
