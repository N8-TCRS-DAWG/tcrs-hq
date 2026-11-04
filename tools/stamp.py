#!/usr/bin/env python3
"""Stamp every app file reference with one build version so browsers never mix old and new files.
Run before each commit: python3 tools/stamp.py"""
import re, glob, time, os
os.chdir(os.path.dirname(os.path.abspath(__file__)) + '/..')
v = time.strftime('%Y%m%d%H%M%S')
def sub(path, pat, rep):
    s = open(path).read(); n = re.sub(pat, rep, s); open(path, 'w').write(n)
for f in glob.glob('js/*.js'):
    # import ... from './x.js' or './x.js?v=...'  and dynamic import('./x.js')
    sub(f, r"""(['"])\./([\w-]+)\.js(\?v=\d+)?\1""", lambda m: f"{m.group(1)}./{m.group(2)}.js?v={v}{m.group(1)}")
sub('index.html', r'href="styles\.css(\?v=\d+)?"', f'href="styles.css?v={v}"')
sub('index.html', r'src="js/main\.js(\?v=\d+)?"', f'src="js/main.js?v={v}"')
sub('index.html', r'src="config\.js(\?v=\d+)?"', f'src="config.js?v={v}"')
sub('sw.js', r"const CACHE = 'tcrs-hq-[\w-]+';", f"const CACHE = 'tcrs-hq-{v}';")
open('js/version.js', 'w').write(f"export const BUILD = '{v}';\n")
print('stamped', v)
