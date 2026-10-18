'use strict';
(() => {
  const paths={
    book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',
    star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    up:'<path d="M12 20V4m-6 6 6-6 6 6"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    external:'<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    plane:'<path d="m21 3-6 18-4-8-8-4 18-6ZM11 13l6-6"/>',
    moon:'<path d="M20 14A8.5 8.5 0 0 1 10 4 8.5 8.5 0 1 0 20 14Z"/><path d="M17 3v4m-2-2h4"/>',
    heart:'<path d="M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7Z"/>',
    spark:'<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3ZM20 2v4m-2-2h4"/>',
    layers:'<path d="m12 3 10 6-10 6L2 9l10-6ZM3 13l9 5 9-5M3 17l9 5 9-5"/>',
    globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    leaf:'<path d="M20 3C8 2 3 7 4 14c1 7 9 8 13 2 2-3 2-8 3-13ZM3 21 15 9"/>',
    bag:'<path d="M5 7h14l2 14H3L5 7ZM8 8V6a4 4 0 0 1 8 0v2"/>',
    case:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c5 4 13 4 18 0M12 13v4"/>'
  };
  const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.book}</svg>`;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $=id=>document.getElementById(id);
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  const {filterDocuments,groupDocuments,formatSize}=window.CatalogCore;
  const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Browsing remains available without local storage. */}}};
  const savedFavorites=storage.get('mespdf-favorites',[]);
  const state={category:'all',favoritesOnly:false,favorites:Array.isArray(savedFavorites)?savedFavorites.filter(x=>typeof x==='string'):[],query:'',sort:'recent',view:storage.get('mespdf-view','grid')==='list'?'list':'grid'};
  let catalog,docsById,catsById;
  const dateLabel=date=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00'));

  function setMenu(open){$('sidebar').classList.toggle('open',open);$('shade').hidden=!open;$('menu-toggle').setAttribute('aria-expanded',String(open));document.body.style.overflow=open?'hidden':'';if(open)$('close-nav').focus();}
  function navigate(category='all',favoritesOnly=false){state.category=category;state.favoritesOnly=favoritesOnly;setMenu(false);render();$('catalogue').scrollIntoView({behavior:'smooth',block:'start'});}
  function reset(){Object.assign(state,{category:'all',favoritesOnly:false,query:'',sort:'recent'});$('search').value='';$('sort').value='recent';render();}
  function renderNavigation(){
    $('category-nav').innerHTML=catalog.categories.map(c=>`<button class="nav-item${state.category===c.id?' active':''}" data-category="${c.id}"${state.category===c.id?' aria-current="true"':''}><span style="color:${c.color}">${icon(c.icon)}</span><span>${escape(c.short)}</span><span class="count">${catalog.documents.filter(d=>d.category===c.id).length}</span></button>`).join('');
    $('all-documents').classList.toggle('active',state.category==='all'&&!state.favoritesOnly);
    $('favorites').classList.toggle('active',state.favoritesOnly);
    $('all-documents').setAttribute('aria-current',String(state.category==='all'&&!state.favoritesOnly));
    $('favorites').setAttribute('aria-current',String(state.favoritesOnly));
    $('fav-count').textContent=state.favorites.filter(id=>docsById.has(id)).length;
  }
  function card(d){
    const c=catsById.get(d.category),favorite=state.favorites.includes(d.id);
    return `<article class="document" style="--color:${c.color};--tint:${c.color}1b"><button class="cover-button" data-open="${d.id}" aria-label="Lire : ${escape(d.title)}"><img src="${d.cover}" alt="Couverture : ${escape(d.title)}" loading="lazy" decoding="async" width="120" height="170"><span class="lang-badge">${escape(d.language)}</span></button><button class="favorite-button icon-button" data-favorite="${d.id}" aria-pressed="${favorite}" aria-label="${favorite?'Retirer des favoris':'Ajouter aux favoris'} : ${escape(d.title)}">${icon('star')}</button><div class="doc-content"><p class="doc-edition">${escape(d.edition)}</p><h4 class="doc-title" dir="auto"><button class="title-button" data-open="${d.id}">${escape(d.title)}</button></h4><p class="doc-author">${escape(d.author)}</p><p class="doc-metadata"><span>${d.pages} page${d.pages>1?'s':''}</span><span class="separator">·</span><span>${formatSize(d.size)}</span><span class="separator">·</span><time datetime="${d.date}">${dateLabel(d.date)}</time></p><div class="doc-actions"><button class="read-button" data-open="${d.id}">${icon('book')}Lire le PDF</button><a class="download-link" href="${d.url}?download=1" download="${escape(d.filename)}" aria-label="Télécharger : ${escape(d.title)}">${icon('download')}Télécharger</a></div></div></article>`;
  }
  function render(){
    if(!catalog)return;
    const filtered=filterDocuments(catalog.documents,state);
    const title=state.favoritesOnly?'Mes favoris':state.category==='all'?'Tous les documents':catsById.get(state.category).name;
    $('catalogue-title').innerHTML=`${escape(title)} <span id="result-count">${filtered.length}</span>`;
    $('breadcrumb').textContent=title;
    $('featured').hidden=!catalog.documents.length||state.category!=='all'||state.favoritesOnly||!!state.query;
    $('active-filter').textContent=state.query?`${filtered.length} résultat${filtered.length>1?'s':''} pour « ${state.query} »`:state.favoritesOnly?'Tes documents favoris, enregistrés sur cet appareil.':state.category==='all'?'Les documents disponibles à la lecture.':catsById.get(state.category).description;
    $('reset').hidden=state.category==='all'&&!state.favoritesOnly&&!state.query&&state.sort==='recent';
    $('grid-view').classList.toggle('selected',state.view==='grid');$('grid-view').setAttribute('aria-pressed',String(state.view==='grid'));
    $('list-view').classList.toggle('selected',state.view==='list');$('list-view').setAttribute('aria-pressed',String(state.view==='list'));
    renderNavigation();
    if(!catalog.documents.length){$('results').innerHTML='<div class="empty"><span>'+icon('book')+'</span><h3>La collection se prépare.</h3><p>Les PDF publiés apparaîtront ici, classés par thème.</p><a class="primary-button" href="/admin">Espace administrateur</a></div>';return;}
    if(!filtered.length){$('results').innerHTML=`<div class="empty"><span>${icon(state.favoritesOnly?'star':'search')}</span><h3>${state.favoritesOnly&&!state.query?'Tes favoris t’attendent ici.':'Aucun document trouvé.'}</h3><p>${state.favoritesOnly&&!state.query?'Appuie sur l’étoile d’un document pour le retrouver ici.':'Essaie un autre mot-clé ou explore toutes les catégories.'}</p><button data-reset>Voir tous les documents</button></div>`;return;}
    $('results').innerHTML=groupDocuments(filtered,catalog.categories).map(({category:c,documents})=>`<section class="category-section" aria-labelledby="heading-${c.id}" style="--color:${c.color};--tint:${c.color}1b"><div class="section-heading"><span class="category-symbol">${icon(c.icon)}</span><h3 id="heading-${c.id}">${escape(c.name)}</h3><span class="section-count">${documents.length} PDF</span><span class="line"></span></div><div class="documents ${state.view==='list'?'list':''}">${documents.map(card).join('')}</div></section>`).join('');
  }
  function openReader(id){
    const d=docsById.get(id);if(!d)return;
    $('reader-title').textContent=d.title;$('reader-title').dir='auto';
    $('reader-category').textContent=catsById.get(d.category).name;
    $('reader-meta').textContent=`${d.author} · ${d.edition} · ${d.pages} pages · ${formatSize(d.size)} · ${d.language}`;
    $('reader-download').href=d.url+'?download=1';$('reader-download').download=d.filename;
    $('reader-tab').href=d.url;$('reader-filename').textContent=d.filename;
    $('reader-frame').src=d.url+'#view=FitH';$('reader-frame').title='Aperçu : '+d.title;
    $('reader').showModal();document.body.style.overflow='hidden';
  }
  function closeReader(){if($('reader').open)$('reader').close();}
  $('reader-close').addEventListener('click',closeReader);
  $('reader').addEventListener('close',()=>{$('reader-frame').removeAttribute('src');document.body.style.overflow='';});
  $('reader').addEventListener('click',event=>{if(event.target===$('reader')){const r=$('reader').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeReader();}});
  $('menu-toggle').addEventListener('click',()=>setMenu(!$('sidebar').classList.contains('open')));
  $('close-nav').addEventListener('click',()=>{setMenu(false);$('menu-toggle').focus();});$('shade').addEventListener('click',()=>setMenu(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('sidebar').classList.contains('open'))setMenu(false);if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!$('reader').open){event.preventDefault();$('search').focus();}});
  $('search').addEventListener('input',()=>{state.query=$('search').value;render();});
  $('sort').addEventListener('change',()=>{state.sort=$('sort').value;render();});
  $('reset').addEventListener('click',reset);
  $('grid-view').addEventListener('click',()=>{state.view='grid';storage.set('mespdf-view',state.view);render();});
  $('list-view').addEventListener('click',()=>{state.view='list';storage.set('mespdf-view',state.view);render();});
  $('all-documents').addEventListener('click',()=>navigate());$('favorites').addEventListener('click',()=>navigate('all',true));
  $('category-nav').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button)navigate(button.dataset.category);});
  $('results').addEventListener('click',event=>{
    const open=event.target.closest('[data-open]');if(open){openReader(open.dataset.open);return;}
    const favorite=event.target.closest('[data-favorite]');if(favorite){const id=favorite.dataset.favorite;state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];storage.set('mespdf-favorites',state.favorites);render();const next=document.querySelector(`[data-favorite="${id}"]`);if(next)next.focus({preventScroll:true});return;}
    if(event.target.closest('[data-reset]'))reset();
  });
  async function init(){
    try{
      const response=await fetch('/api/catalog',{cache:'no-store'});if(!response.ok)throw Error('Catalogue indisponible');catalog=await response.json();
      docsById=new Map(catalog.documents.map(d=>[d.id,d]));catsById=new Map(catalog.categories.map(c=>[c.id,c]));
      $('all-count').textContent=catalog.documents.length;$('total-stat').textContent=catalog.documents.length;$('category-count').textContent=catalog.categories.length;
      $('theme-stat').textContent=catalog.categories.length;
      document.querySelector('.update-date').textContent=catalog.updated?'Mis à jour le '+new Intl.DateTimeFormat('fr-FR',{dateStyle:'long'}).format(new Date(catalog.updated)):'';
      const featured=filterDocuments(catalog.documents,{sort:'recent'})[0];
      if(featured){$('featured-cover').src=featured.cover;$('featured-title').textContent=featured.title;document.querySelector('.featured-kicker').textContent=catsById.get(featured.category).name;document.querySelector('.featured-copy>p:not(.featured-kicker)').textContent=featured.author;document.querySelector('.featured-edition').textContent=featured.edition+' · '+featured.language;$('featured-open').onclick=()=>openReader(featured.id);}
      render();
    }catch(error){$('featured').hidden=true;$('results').innerHTML='<div class="empty"><h3>La collection n’a pas pu être chargée.</h3><p>Vérifie ta connexion puis recharge la page.</p><button id="reload">Réessayer</button></div>';$('reload').addEventListener('click',()=>location.reload());}
  }
  init();
})();
