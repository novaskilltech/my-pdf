(function(root){
  'use strict';
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g,'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي');
  function filterDocuments(documents,{category='all',favoritesOnly=false,favorites=[],query='',sort='recent'}={}){
    const terms=normalize(query).trim().split(/\s+/).filter(Boolean);
    const favoritesSet=new Set(favorites);
    return documents.filter(d=>(category==='all'||d.category===category)&&(!favoritesOnly||favoritesSet.has(d.id))&&terms.every(term=>normalize([d.title,d.author,d.filename,d.edition,d.searchText].join(' ')).includes(term)))
      .sort((a,b)=>sort==='alpha'?a.title.localeCompare(b.title,'fr'):sort==='pages'?b.pages-a.pages:sort==='oldest'?a.date.localeCompare(b.date)||b.originalIndex-a.originalIndex:b.date.localeCompare(a.date)||a.originalIndex-b.originalIndex);
  }
  function groupDocuments(documents,categories){return categories.map(category=>({category,documents:documents.filter(d=>d.category===category.id)})).filter(g=>g.documents.length);}
  function formatSize(size){return size>=1048576?(size/1048576).toLocaleString('fr-FR',{maximumFractionDigits:1})+' Mo':Math.max(1,Math.round(size/1024))+' Ko';}
  const api={normalize,filterDocuments,groupDocuments,formatSize};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CatalogCore=api;
})(typeof window!=='undefined'?window:globalThis);
