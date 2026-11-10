# Brings a sample page's templates up to date with the editor's own page: sync.py <editor dir> <page dir>=<Board> ...
import re, sys
root = sys.argv[1]; main = open(root + '/index.html').read()
tpl = {m.group(1): m.group(0) for m in re.finditer(r'<template data-dc="(\w+)">.*?</template>', main, re.S)}
def need(name, seen):
    if name in seen: return
    seen.append(name)
    for c in re.findall(r'<dc-import name="(\w+)"', tpl[name]): need(c, seen)
for arg in sys.argv[2:]:
    page, board = arg.split('='); p = f'{root}/{page}/index.html'; s = open(p).read(); names = []; need(board, names)
    a = s.index('<template data-dc='); b = s.rindex('</template>') + len('</template>')
    out = s[:a] + '\n'.join(tpl[n] for n in names) + s[b:]
    if out != s: open(p, 'w').write(out); print(page, 'synced:', ', '.join(names))
    else: print(page, 'already the same')
