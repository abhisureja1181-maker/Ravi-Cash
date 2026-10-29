"""Builds subset Inter fonts for the app (UI = WOFF, PDF = TrueType).
Source: Inter (SIL OFL 1.1) installed on the build machine as OpenType/CFF; converted to TrueType outlines
because the PDF writer embeds glyf-based fonts."""
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools import subset

SRC = '/usr/share/fonts/opentype/inter/Inter-%s.otf'
WEIGHTS = {'Regular': 400, 'Medium': 500, 'SemiBold': 600, 'Bold': 700}
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [
    0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20B9, 0x2190, 0x2192, 0x2191, 0x2193, 0x2713, 0x00B7, 0x2212, 0x00D7]

def otf_to_ttf(font):
    glyph_order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    glyf = newTable('glyf'); glyf.glyphOrder = glyph_order; glyf.glyphs = {}
    for name in glyph_order:
        pen = TTGlyphPen(glyph_set)
        glyph_set[name].draw(Cu2QuPen(pen, 1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    font['loca'] = newTable('loca'); font['glyf'] = glyf
    del font['CFF ']
    if 'VORG' in font: del font['VORG']
    maxp = font['maxp']; maxp.tableVersion = 0x00010000
    for a in ('maxZones','maxTwilightPoints','maxStorage','maxFunctionDefs','maxInstructionDefs','maxStackElements','maxSizeOfInstructions','maxComponentElements'):
        setattr(maxp, a, 0)
    maxp.maxZones = 1
    maxp.maxPoints = maxp.maxContours = maxp.maxCompositePoints = maxp.maxCompositeContours = maxp.maxComponentDepth = 0
    font['head'].glyphDataFormat = 0
    font['post'].formatType = 2.0
    font['post'].extraNames = []; font['post'].mapping = {}; font['post'].glyphOrder = glyph_order
    font.sfntVersion = '\x00\x01\x00\x00'

for name, w in WEIGHTS.items():
    f = TTFont(SRC % name)
    otf_to_ttf(f)
    tmp = '/tmp/Inter-%s-full.ttf' % name
    f.save(tmp)
    for flavor, ext in ((None, 'ttf'), ('woff', 'woff')):
        opts = subset.Options()
        opts.layout_features = []          # no GSUB/GPOS: the PDF writer does not shape text
        opts.name_IDs = [1, 2, 4, 6]
        opts.notdef_outline = True
        opts.hinting = False
        opts.drop_tables += ['DSIG', 'GDEF', 'GPOS', 'GSUB', 'kern', 'STAT', 'MATH', 'FFTM']
        opts.flavor = flavor
        ft = TTFont(tmp)
        s = subset.Subsetter(opts); s.populate(unicodes=UNICODES); s.subset(ft); ft.flavor = flavor
        out = 'app/fonts/Inter-%s.%s' % (name, ext)
        ft.save(out)
    import os
    print(name, os.path.getsize('app/fonts/Inter-%s.ttf' % name), os.path.getsize('app/fonts/Inter-%s.woff' % name))
# rupee sanity
t = TTFont('app/fonts/Inter-Regular.ttf'); print('rupee glyph present:', 0x20B9 in t.getBestCmap(), 'glyf' in t)
