import { esc } from './art.js';
import { readingType } from './reader.js';

// An author's essay (site/data/authors/<slug>.json, built from content/authors/<slug>.md): one page set in the reader's
// type at the reader's measure, scrolled rather than paged. Its HTML fields come escaped from the build.
export function renderAuthor(root, doc) {
  const t = readingType();
  const life = doc.born || doc.died ? `${esc(doc.born || '?')}–${esc(doc.died || '')}` : '';
  const sid = title => `a-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const parts = [...doc.sections.map(s => s.title), doc.books.length && 'In this library', doc.sources.length && 'Sources'].filter(Boolean);
  root.innerHTML = `
  <div class="adoc-wrap">
    <article class="adoc" style="--fs:${t.fs}px;--lh:${t.lh};--align:${t.align};--m:${t.margin}px">
      <header class="adoc-head">
        <h1>${esc(doc.name)}</h1>
        ${life ? `<p class="adoc-dates">${life}</p>` : ''}
        <nav class="adoc-toc" aria-label="Sections">${parts.map(p => `<a href="#${sid(p)}" data-jump="${sid(p)}">${esc(p)}</a>`).join('')}<a href="${esc(doc.graph)}">In the graph</a></nav>
      </header>
      <div class="adoc-lead">${doc.intro.map(p => `<p>${p}</p>`).join('')}</div>
      ${doc.sections.map(s => `<section id="${sid(s.title)}"><h2>${esc(s.title)}</h2>${s.paras.map(p => `<p>${p}</p>`).join('')}</section>`).join('')}
      ${doc.books.length ? `<section id="${sid('In this library')}"><h2>In this library</h2><ul class="adoc-books">${doc.books.map(b => `
        <li>
          <p class="adoc-book"><a href="${esc(b.read)}"><i>${esc(b.title)}</i></a>${b.year ? `<span>${esc(String(b.year))}</span>` : ''}</p>
          <p>${b.html}</p>
          <p class="adoc-go"><a href="${esc(b.read)}">Read</a><a href="${esc(b.graph)}">In the graph</a></p>
        </li>`).join('')}</ul></section>` : ''}
      ${doc.sources.length ? `<section id="${sid('Sources')}" class="adoc-sources"><h2>Sources</h2><ol>${doc.sources.map(s => `<li>${s}</li>`).join('')}</ol></section>` : ''}
    </article>
  </div>`;
  scrollTo(0, 0);
  // Section links scroll within the page; the hash stays the route.
  const onClick = e => {
    const a = e.target.closest('[data-jump]');
    if (!a) return;
    e.preventDefault();
    root.querySelector(`#${a.dataset.jump}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
