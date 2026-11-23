# Grand Viale: draws every picture of the board as isometric pixel art and writes them, with board.json,
# into src/web/assets/grandviale/pixel. Each object is a small voxel model drawn with three shaded faces
# per voxel (2:1 isometric). Run from the repository root:
#   uv run --no-project --with pillow python -I src/art/pixelart.py
# A picture of the whole board with every hotel complete goes to build/preview/board-<view>.png.
# The board is drawn from two opposite sides (VIEWS): the game shows the side from which nothing hides
# what is happening.
#
# Board coordinates (the same the game uses): x grows to the lower right of the screen, y to the lower left,
# z up; one unit is one voxel. A voxel at (x, y, z) is drawn at pixel ((x - y) * 2, x + y - 2 * z).

import json
import math
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "src", "web", "assets", "grandviale", "pixel")
PREVIEW = os.path.join(ROOT, "build", "preview")


def rnd(x, y, z=0):
    n = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536


_colours = {}


def col(c):
    if isinstance(c, tuple):
        return c
    if c not in _colours:
        s = c.lstrip("#")
        _colours[c] = tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    return _colours[c]


def shade(c, f):
    return tuple(max(0, min(255, int(ch * f))) for ch in col(c))


GRASS = ["#6ab04c", "#5fa644", "#74b957"]
WATER = ["#3a86c8", "#4393d6", "#3a86c8", "#6bb3e8"]
LEAVES = ["#2d6a4f", "#357a5a", "#40916c"]
DARK_LEAVES = ["#1b4332", "#24553f", "#2d6a4f"]
ROCK = ["#8d99ae", "#7b869b", "#a3adbf"]
PAVING = ["#cfd8e3", "#c3cede", "#d8e0ea"]
ASPHALT = ["#495057", "#4f565e"]
SAND = ["#e9d8a6", "#e3cf98", "#f0e2b6"]
SNOW = ["#f1f5f9", "#e2e8f0", "#ffffff"]
PLINTH = "#eadfc4"
WHITE = "#f8f9fa"
DARK = "#2b2d42"


class Vox(dict):
    def put(self, x, y, z, c):
        if isinstance(c, list):
            c = c[int(rnd(x, y, z) * len(c))]
        self[(x, y, z)] = col(c)

    def box(self, x, y, z, w, d, h, c):
        for i in range(x, x + w):
            for j in range(y, y + d):
                for k in range(z, z + h):
                    self.put(i, j, k, c)

    def clear(self, x, y, z, w, d, h):
        for i in range(x, x + w):
            for j in range(y, y + d):
                for k in range(z, z + h):
                    self.pop((i, j, k), None)

    # windows on all four walls, so that a model can be mirrored or turned
    def windows(self, x, y, z, w, d, h, glass, lit, sx=2, sz=3):
        for k in range(z, z + h):
            if (k - z) % sz == 0:
                continue
            floor = (k - z) // sz
            for i in range(x + 1, x + w - 1):
                if sx == 1 or (i - x) % sx == 1:
                    c = lit if rnd(i, floor, 7) < 0.16 else glass
                    self.put(i, y + d - 1, k, c)
                    self.put(i, y, k, c)
            for j in range(y + 1, y + d - 1):
                if sx == 1 or (j - y) % sx == 1:
                    c = lit if rnd(j, floor, 13) < 0.16 else glass
                    self.put(x + w - 1, j, k, c)
                    self.put(x, j, k, c)

    def block(self, x, y, z, w, d, h, wall, glass="#3d5a80", lit="#ffd166", sx=2, sz=3):
        self.box(x, y, z, w, d, h, wall)
        self.windows(x, y, z, w, d, h, glass, lit, sx, sz)

    def roof(self, x, y, z, w, d, c, ridge="x"):
        steps = (d + 1) // 2 if ridge == "x" else (w + 1) // 2
        for k in range(steps):
            if ridge == "x":
                self.box(x, y + k, z + k, w, d - 2 * k, 1, c)
            else:
                self.box(x + k, y, z + k, w - 2 * k, d, 1, c)

    def pyramid(self, x, y, z, w, d, c):
        for k in range((min(w, d) + 1) // 2):
            self.box(x + k, y + k, z + k, w - 2 * k, d - 2 * k, 1, c)

    def cyl(self, cx, cy, z, r, h, c):
        for i in range(int(cx - r - 1), int(cx + r + 2)):
            for j in range(int(cy - r - 1), int(cy + r + 2)):
                if (i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r:
                    for k in range(z, z + h):
                        self.put(i, j, k, c)

    def dome(self, cx, cy, z, r, c):
        for k in range(int(r) + 1):
            self.cyl(cx, cy, z + k, math.sqrt(max(r * r - k * k, 0.3)), 1, c)

    def cone(self, cx, cy, z, r, h, c):
        for k in range(h):
            self.cyl(cx, cy, z + k, max(r * (1 - k / h), 0.6), 1, c)

    def sphere(self, cx, cy, cz, r, c):
        for i in range(int(cx - r - 1), int(cx + r + 2)):
            for j in range(int(cy - r - 1), int(cy + r + 2)):
                for k in range(int(cz - r - 1), int(cz + r + 2)):
                    if (i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 + (k + 0.5 - cz) ** 2 <= r * r:
                        self.put(i, j, k, c)

    def ring(self, x, y, z, w, d, h, c):
        self.box(x, y, z, w, 1, h, c)
        self.box(x, y + d - 1, z, w, 1, h, c)
        self.box(x, y, z, 1, d, h, c)
        self.box(x + w - 1, y, z, 1, d, h, c)

    def add(self, other, dx=0, dy=0, dz=0):
        for (x, y, z), c in other.items():
            self[(x + dx, y + dy, z + dz)] = c

    def turned(self, change):
        result = Vox()
        for (x, y, z), c in self.items():
            result[change(x, y) + (z,)] = c
        return result


# ---------------------------------------------------------------- small things shared by many objects

def tree(v, x, y, z=0, r=3):
    v.box(x, y, z, 1, 1, r + 1, "#6b4a32")
    v.sphere(x + 0.5, y + 0.5, z + r + 2.5, r, LEAVES)


def pine(v, x, y, z=0, h=10, snow=False):
    v.box(x, y, z, 1, 1, 2, "#6b4a32")
    for k in range(h):
        r = 0.8 + 2.4 * (1 - k / h) + (0.7 if k % 3 == 0 else 0)
        white = snow and (k % 3 == 2 or k > h - 3)
        v.cyl(x + 0.5, y + 0.5, z + 2 + k, r, 1, SNOW if white else DARK_LEAVES)


def palm(v, x, y, z=0, h=9):
    top = x
    for k in range(h):
        top = x + (k * 2) // h
        v.put(top, y, z + k, "#a47148" if k % 2 else "#8b5e3c")
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        for s in (1, 2, 3):
            v.put(top + dx * s, y + dy * s, z + h - (0 if s < 3 else 1), ["#40916c", "#52b788"])
    v.put(top, y, z + h, "#52b788")


def umbrella(v, x, y, z, c):
    v.box(x, y, z, 1, 1, 3, WHITE)
    v.box(x - 1, y - 1, z + 3, 3, 3, 1, c)
    v.put(x, y, z + 4, WHITE)


def pool(v, x, y, z, w, d):
    v.box(x, y, z, w, d, 1, "#f1f5f9")
    v.box(x + 1, y + 1, z, w - 2, d - 2, 1, WATER)


def tennis(v, x, y, z, w, d, court="#c8553d"):
    v.box(x, y, z, w, d, 1, "#3a7d5c")
    v.box(x + 1, y + 1, z, w - 2, d - 2, 1, court)
    v.ring(x + 2, y + 2, z, w - 4, d - 4, 1, WHITE)
    v.box(x + w // 2, y + 2, z, 1, d - 4, 1, WHITE)
    v.box(x + 1, y + d // 2, z + 1, w - 2, 1, 1, WHITE)
    for cx, cy in ((x, y), (x + w - 1, y), (x, y + d - 1), (x + w - 1, y + d - 1)):
        v.box(cx, cy, z + 1, 1, 1, 3, "#adb5bd")


def awning(v, x, y, z, length, c, face="y"):
    for i in range(length):
        colour = c if i % 2 == 0 else WHITE
        if face == "y":
            v.put(x + i, y, z, colour)
        else:
            v.put(x, y + i, z, colour)


def flag(v, x, y, z, h, c):
    v.box(x, y, z, 1, 1, h, "#adb5bd")
    v.box(x + 1, y, z + h - 3, 4, 1, 3, c)


def fountain(v, cx, cy, z, r):
    v.cyl(cx, cy, z, r, 2, "#dfe7ef")
    v.cyl(cx, cy, z + 1, r - 1, 1, WATER)
    v.box(int(cx), int(cy), z + 1, 1, 1, 4, "#bfe3ff")


def bushes(v, spots, c):
    for x, y in spots:
        v.box(x, y, 0, 2, 2, 2, c)


def crane(v, x, y, height):
    v.box(x - 1, y - 1, 0, 4, 4, 1, "#6c757d")
    for k in range(height):
        v.box(x, y, k, 2, 2, 1, "#ffbe0b" if k % 2 else "#e0a800")
    v.box(x - 1, y - 1, height, 4, 4, 3, "#ffbe0b")
    v.box(x + 2, y, height + 1, 1, 2, 1, "#bfe3ff")
    for i in range(-6, 19):
        v.put(x + i, y, height + 4, "#ffbe0b" if i % 2 else "#e0a800")
    v.box(x - 7, y - 1, height + 2, 3, 3, 3, "#6c757d")
    v.box(x, y, height + 3, 1, 1, 4, "#e0a800")
    v.box(x + 14, y, height - 6, 1, 1, 10, "#343a40")
    v.box(x + 13, y - 1, height - 8, 3, 3, 2, "#c8553d")


def person(v, x, y, z, shirt, skin="#f1c27d"):
    v.box(x, y, z, 1, 1, 2, DARK)
    v.box(x, y, z + 2, 1, 1, 2, shirt)
    v.put(x, y, z + 4, skin)


S = 44  # side of a hotel lot


def lot(ground=GRASS, hedge=True):
    v = Vox()
    v.box(0, 0, -3, S, S, 1, "#cdbf9f")
    v.box(0, 0, -2, S, S, 1, PLINTH)
    v.box(1, 1, -1, S - 2, S - 2, 1, ground)
    if hedge:
        v.ring(2, 2, 0, S - 4, S - 4, 1, LEAVES)
        v.clear(18, S - 3, 0, 8, 1, 1)
    return v


# ---------------------------------------------------------------- the eight hotels
# Each function takes the number of pieces already built (0: bare lot). The pieces go up in the order of
# the hotel's "stages" in grandviale.js: its buildings first, the leisure area last.
# Drawn for a lot at the far side of the avenue: buildings at the back, garden and gate towards high y.

def girasole(s):  # the cheap one: a single building
    v = lot()
    for i in range(5, 38):
        for j in range(36, 41):
            if (i + j) % 2 == 0:
                v.put(i, j, 0, "#40916c")
                v.put(i, j, 1, "#ffd60a" if rnd(i, j) < 0.7 else "#40916c")
    tree(v, 8, 24, 0, 3)
    if s >= 1:
        v.block(6, 5, 0, 30, 12, 10, "#f6c945", glass="#386641")
        v.box(6, 5, 10, 30, 12, 1, "#d9b38c")
        v.ring(6, 5, 11, 30, 12, 1, "#fff3c4")
        v.box(31, 7, 11, 4, 4, 3, "#fff3c4")
        awning(v, 8, 17, 3, 26, "#f77f00")
        v.box(18, 17, 0, 6, 3, 1, "#dfe7ef")
    if s >= 2:
        umbrella(v, 11, 9, 11, "#f77f00")
        umbrella(v, 19, 12, 11, WHITE)
        umbrella(v, 26, 9, 11, "#f77f00")
        pool(v, 22, 22, 0, 16, 9)
        for i in (23, 27, 31, 35):
            v.box(i, 32, 0, 1, 2, 1, WHITE)
        umbrella(v, 25, 32, 0, "#f6c945")
        umbrella(v, 33, 32, 0, "#f6c945")
        tree(v, 15, 27, 0, 2)
        v.box(5, 31, 0, 12, 1, 1, "#8b5e3c")
    return v


def faro(s):
    v = lot(ground=SAND + ["#6ab04c"], hedge=False)
    v.box(1, 34, -1, S - 2, 9, 1, WATER)
    for i in range(46):
        v.box(2 + int(rnd(i, 1) * 17), 17 + int(rnd(i, 2) * 17), 0, 2, 2, 1 + int(rnd(i, 3) * 3), ROCK)
    v.box(31, 33, 0, 3, 10, 1, "#a47148")
    for j in (34, 38, 42):
        v.box(30, j, 0, 1, 1, 2, "#6b4a32")
    if s >= 1:
        for k in range(36):
            v.cyl(11, 26, 2 + k, 5.2 - k * 0.04, 1, "#e63946" if (k // 6) % 2 == 0 else WHITE)
        for k in (10, 20, 30):
            v.put(11, 30, k, "#3d5a80")
            v.put(15, 26, k, "#3d5a80")
        v.cyl(11, 26, 38, 6.2, 1, "#343a40")
        v.cyl(11, 26, 39, 3.2, 5, "#ffe066")
        v.cyl(11, 26, 44, 4.4, 1, "#343a40")
        v.cone(11, 26, 45, 4, 4, "#c1121f")
        v.box(10, 25, 49, 1, 1, 3, "#343a40")
    if s >= 2:
        v.block(22, 6, 0, 18, 12, 10, "#fdf6e3")
        v.roof(21, 5, 10, 20, 14, "#c8553d", "x")
        v.box(36, 8, 14, 2, 2, 5, "#9d4636")
    if s >= 3:
        v.block(27, 21, 0, 12, 9, 7, "#fdf6e3")
        v.roof(26, 20, 7, 14, 11, "#457b9d", "y")
        awning(v, 28, 30, 3, 10, "#e63946")
    if s >= 4:
        v.box(20, 21, 0, 6, 10, 1, "#d9b38c")
        umbrella(v, 22, 23, 1, "#e63946")
        umbrella(v, 22, 28, 1, "#457b9d")
        v.box(36, 38, 0, 6, 3, 1, WHITE)
        v.box(37, 39, 1, 3, 1, 1, "#e63946")
        v.box(38, 39, 2, 1, 1, 5, "#6b4a32")
        v.box(39, 39, 3, 2, 1, 4, WHITE)
        v.box(22, 38, 0, 5, 2, 1, "#ffbe0b")
        palm(v, 40, 31, 0, 7)
        palm(v, 24, 33, 0, 6)
    return v


def trepini(s):
    v = lot()
    wall, tiles, shutters = "#fbf5e6", ["#c8553d", "#bd4b35"], "#386641"
    pine(v, 33, 26, 0, 16)
    pine(v, 38, 32, 0, 19)
    pine(v, 33, 38, 0, 14)
    if s >= 1:
        v.block(5, 5, 0, 17, 10, 9, wall, glass=shutters)
        v.roof(4, 4, 9, 19, 12, tiles, "x")
        v.box(8, 7, 12, 2, 2, 5, "#9d4636")
    if s >= 2:
        v.block(25, 5, 0, 10, 17, 12, wall, glass=shutters)
        v.roof(24, 4, 12, 12, 19, tiles, "y")
    if s >= 3:
        v.block(5, 18, 0, 10, 12, 7, wall, glass=shutters)
        v.roof(4, 17, 7, 12, 14, tiles, "y")
        awning(v, 6, 30, 3, 8, "#52b788")
    if s >= 4:
        for i in range(15, 25, 2):
            v.box(i, 15, 0, 1, 1, 5, "#8b5e3c")
        v.box(15, 15, 5, 10, 3, 1, "#52b788")
        tennis(v, 17, 23, 0, 12, 18)
        v.box(5, 34, 0, 8, 1, 1, "#8b5e3c")
        v.box(5, 38, 0, 8, 1, 1, "#8b5e3c")
        for i in (6, 9, 12):
            v.box(i, 35, 0, 1, 3, 1, "#d9b38c")
        bushes(v, [(4, 40), (8, 40), (12, 40)], ["#e63946", "#f1a7d1", "#40916c"])
    return v


def chalet(v, x, y, w, d, h, ridge):
    v.box(x, y, 0, w, d, 2, ROCK)
    for k in range(2, h):
        v.box(x, y, k, w, d, 1, "#8b5e3c" if k % 2 else "#7a5230")
    v.windows(x, y, 2, w, d, h - 2, "#ffd166", "#ffe8a3", 3, 3)
    v.roof(x - 1, y - 1, h, w + 2, d + 2, SNOW, ridge)
    v.box(x - 1, y - 1, h, w + 2, d + 2, 1, "#5c3d24")


def stella(s):
    v = lot(ground=SNOW, hedge=False)
    for i in range(20):
        v.box(26 + int(rnd(i, 5) * 14), 24 + int(rnd(i, 6) * 5), 0, 2, 2, 1 + int(rnd(i, 7) * 4), ROCK + SNOW)
    for x, y, h in ((36, 34, 13), (40, 38, 9), (31, 39, 11), (3, 36, 12), (8, 40, 9), (40, 4, 10), (3, 3, 8)):
        pine(v, x, y, 0, h, snow=True)
    if s >= 1:
        chalet(v, 5, 5, 20, 12, 10, "x")
        v.box(20, 8, 14, 2, 2, 5, ROCK)
    if s >= 2:
        chalet(v, 28, 9, 11, 11, 8, "y")
    if s >= 3:
        chalet(v, 6, 22, 10, 10, 7, "y")
    if s >= 4:
        v.cyl(24, 31, 0, 3.6, 2, "#8b5e3c")
        v.cyl(24, 31, 1, 2.6, 1, ["#6bb3e8", "#bfe3ff"])
        v.sphere(15.5, 37.5, 2, 2.2, "#ffffff")
        v.sphere(15.5, 37.5, 5, 1.5, "#ffffff")
        v.put(16, 37, 5, "#f77f00")
        v.box(19, 38, 0, 4, 2, 2, ["#8b5e3c", "#a47148", "#5c3d24"])
        for j in (22, 26, 30):
            v.box(19, j, 0, 1, 1, 6, "#343a40")
        v.box(19, 22, 6, 1, 9, 1, "#343a40")
        v.box(19, 25, 4, 1, 2, 2, "#e63946")
    return v


def ortensia(s):
    v = lot()
    wall, lilac = "#f3edf7", "#b388eb"
    hydrangea = ["#b388eb", "#8e7dbe", "#f1a7d1", "#7fa6e8", "#9d7fe0"]
    tree(v, 4, 40, 0, 2)
    tree(v, 40, 40, 0, 2)
    if s >= 1:
        v.block(9, 6, 0, 26, 14, 12, wall, glass="#6d597a")
        v.box(8, 5, 12, 28, 16, 1, lilac)
        for i in range(14, 31, 3):
            v.box(i, 22, 0, 1, 1, 8, "#ffffff")
        v.box(13, 20, 8, 19, 4, 1, wall)
        v.roof(13, 20, 9, 19, 4, lilac, "x")
        v.box(19, 23, 0, 7, 3, 1, "#dfe7ef")
    if s >= 2:
        v.block(3, 6, 0, 6, 20, 9, wall, glass="#6d597a")
        v.box(3, 5, 9, 7, 22, 1, lilac)
    if s >= 3:
        v.block(35, 6, 0, 6, 20, 9, wall, glass="#6d597a")
        v.box(34, 5, 9, 7, 22, 1, lilac)
    if s >= 4:
        v.cyl(22, 13, 13, 6, 3, wall)
        for a in range(12):
            v.put(int(22 + 5.6 * math.cos(a * math.pi / 6)), int(13 + 5.6 * math.sin(a * math.pi / 6)), 14, "#6d597a")
        v.dome(22, 13, 16, 6, ["#b388eb", "#a878e0"])
        v.box(21, 12, 22, 1, 1, 3, "#ffd166")
    if s >= 5:
        fountain(v, 22, 33, 0, 4.5)
        v.box(20, 26, -1, 4, 3, 1, SAND)
        v.box(20, 38, -1, 4, 4, 1, SAND)
        bushes(v, [(11, 29), (14, 29), (11, 33), (11, 37), (14, 38), (29, 29), (32, 29), (32, 33), (32, 37),
                   (28, 38), (15, 34), (28, 34)], hydrangea)
    return v


def aurora(s):
    v = lot()
    pink, pale, gold = "#ff8fab", "#ffc2d1", ["#f4d35e", "#eec643"]
    palm(v, 6, 33, 0, 10)
    palm(v, 38, 38, 0, 9)
    if s >= 1:
        v.block(5, 5, 0, 34, 10, 10, pink)
        v.ring(5, 5, 10, 34, 10, 1, WHITE)
        awning(v, 16, 15, 3, 22, "#ff5c8a")
        v.box(20, 15, 0, 6, 4, 1, "#e63946")
        for i in (19, 26):
            v.box(i, 18, 0, 1, 1, 6, "#f4d35e")
        v.box(19, 15, 6, 8, 4, 1, WHITE)
    if s >= 2:
        v.block(9, 5, 10, 26, 10, 6, pale)
        v.ring(9, 5, 16, 26, 10, 1, WHITE)
    if s >= 3:
        v.block(15, 4, 16, 14, 12, 6, pink)
        v.box(14, 3, 22, 16, 14, 1, WHITE)
        v.cyl(22, 10, 23, 5, 2, WHITE)
        v.dome(22, 10, 25, 5, gold)
        v.box(21, 9, 30, 1, 1, 4, "#f4d35e")
    if s >= 4:
        v.block(5, 15, 0, 10, 15, 7, pale)
        v.ring(5, 15, 7, 10, 15, 1, WHITE)
    if s >= 5:
        v.block(29, 36, 0, 10, 5, 5, pale)
        v.box(28, 35, 5, 12, 7, 1, "#ff5c8a")
    if s >= 6:
        tennis(v, 5, 15, 7, 10, 15, "#4895ef")
        umbrella(v, 6, 8, 10, "#ff8fab")
        umbrella(v, 37, 8, 10, "#ff8fab")
        pool(v, 17, 21, 0, 22, 13)
        v.box(18, 22, 0, 5, 3, 1, "#f1f5f9")
        v.cyl(31, 27, 0, 2.6, 1, SAND)
        palm(v, 30, 27, 1, 8)
        v.box(36, 19, 0, 2, 2, 6, "#adb5bd")
        for k in range(6):
            v.box(36 - k, 22 + k // 2, 5 - k, 2, 2, 1, "#ffd60a")
        for j in (36, 38, 40):
            v.box(18, j, 0, 2, 1, 1, WHITE)
            v.box(24, j, 0, 2, 1, 1, WHITE)
        umbrella(v, 21, 38, 0, "#ff8fab")
        palm(v, 11, 38, 0, 8)
    return v


def belvedere(s):
    v = lot()
    wall, slate, accent = "#f7e1bc", ["#5c677d", "#667189"], "#f4a261"
    v.box(15, 15, -1, 14, 27, 1, SAND)
    if s >= 1:
        v.block(6, 5, 0, 32, 10, 13, wall)
        v.box(6, 5, 13, 32, 10, 1, accent)
        v.box(7, 6, 14, 30, 8, 2, slate)
    if s >= 2:
        v.block(18, 4, 0, 8, 12, 18, wall)
        v.box(18, 4, 18, 8, 12, 1, accent)
        v.pyramid(18, 4, 19, 8, 12, slate)
        flag(v, 21, 9, 23, 8, "#e63946")
        v.box(20, 16, 6, 4, 1, 4, "#ffd166")
    if s >= 3:
        v.block(6, 15, 0, 9, 16, 10, wall)
        v.box(6, 15, 10, 9, 16, 1, accent)
        v.box(7, 15, 11, 7, 15, 2, slate)
    if s >= 4:
        v.block(29, 15, 0, 9, 16, 10, wall)
        v.box(29, 15, 10, 9, 16, 1, accent)
        v.box(30, 15, 11, 7, 15, 2, slate)
    if s >= 5:
        for cx, cy in ((10.5, 32.5), (33.5, 32.5), (6.5, 5.5), (37.5, 5.5)):
            v.cyl(cx, cy, 0, 3.4, 15, wall)
            v.put(int(cx), int(cy + 3), 8, "#3d5a80")
            v.put(int(cx + 3), int(cy), 8, "#3d5a80")
            v.cyl(cx, cy, 15, 4, 1, accent)
            v.cone(cx, cy, 16, 3.6, 7, slate)
    if s >= 6:
        fountain(v, 22, 24, 0, 3.6)
        for x in (16, 25):
            for y in (31, 36):
                v.ring(x, y, 0, 4, 4, 1, LEAVES)
                v.box(x + 1, y + 1, 0, 2, 2, 1, ["#e63946", "#ffd166"])
        v.box(21, 33, 0, 2, 2, 1, "#dfe7ef")
        v.box(21, 33, 1, 1, 1, 4, WHITE)
        for y in (18, 22, 26):
            tree(v, 16, y, 0, 1)
            tree(v, 27, y, 0, 1)
    return v


def zaffiro(s):
    v = lot(ground=PAVING, hedge=False)
    frame, glass = "#1d4e89", "#5fa8f5"
    for x, y in ((4, 40), (40, 40), (40, 4), (30, 40), (12, 40)):
        tree(v, x, y, 0, 1)
    if s >= 1:
        v.block(8, 23, 0, 12, 14, 28, frame, glass="#90e0ef", lit="#d7efff", sx=1, sz=3)
        v.box(8, 23, 28, 12, 14, 1, "#d9b38c")
        v.box(6, 19, 0, 13, 2, 1, "#e63946")
    if s >= 2:
        v.block(22, 8, 0, 14, 12, 42, "#274c77", glass="#8ecae6", lit="#d7efff", sx=2, sz=3)
        v.box(22, 8, 42, 14, 12, 1, "#495057")
    if s >= 3:
        v.block(6, 6, 0, 13, 13, 56, frame, glass=glass, lit="#d7efff", sx=1, sz=4)
        v.box(8, 8, 56, 9, 9, 3, "#14365f")
        v.box(12, 12, 59, 1, 1, 9, "#adb5bd")
        v.put(12, 12, 68, "#e63946")
        v.box(19, 11, 30, 3, 4, 3, glass)
        v.box(19, 11, 33, 3, 4, 1, frame)
    if s >= 4:
        v.block(23, 24, 0, 16, 14, 6, "#e0e6ee", glass="#274c77")
    if s >= 5:
        pool(v, 9, 24, 28, 10, 7)
        umbrella(v, 11, 33, 29, "#4895ef")
        umbrella(v, 16, 34, 29, WHITE)
        v.cyl(29, 14, 42, 5.4, 1, "#e63946")
        v.cyl(29, 14, 42, 4.4, 1, "#495057")
        for a, b in ((27, 12), (27, 13), (27, 14), (27, 15), (28, 14), (29, 14), (30, 12), (30, 13), (30, 14), (30, 15)):
            v.put(a, b, 42, WHITE)
        v.box(24, 25, 6, 14, 12, 1, GRASS)
        tree(v, 27, 28, 7, 2)
        tree(v, 34, 33, 7, 2)
        tree(v, 34, 27, 7, 1)
        v.box(28, 32, 7, 3, 3, 1, WATER)
        fountain(v, 22, 40, 0, 2.6)
    return v


def turn_left(x, y):   # for the lot on the left of the avenue: gate towards high x
    return (y, x)


def turn_right(x, y):  # for the lot on the right: gate towards low x
    return (S - 1 - y, x)


def turn_front(x, y):  # for the lots on the near side: gate towards low y
    return (S - 1 - x, S - 1 - y)


def same(x, y):
    return (x, y)


# In the order of HOTEL_LIST in grandviale.js: model, pieces (buildings + leisure area), corner of the lot,
# how the model is turned, where the crane stands in the lot and how tall it is.
HOTELS = [
    (girasole, 2, (91, 126), turn_front, (38, 26), 22),
    (faro, 4, (44, 126), same, (40, 22), 30),
    (trepini, 4, (138, 126), turn_front, (27, 40), 26),
    (stella, 4, (44, 0), same, (36, 26), 24),
    (ortensia, 5, (182, 63), turn_right, (38, 34), 30),
    (aurora, 6, (0, 63), turn_left, (40, 20), 40),
    (belvedere, 6, (138, 0), same, (40, 22), 34),
    (zaffiro, 5, (91, 0), same, (39, 22), 72),
]


# ---------------------------------------------------------------- other pieces

def car(colour, kind="sedan"):
    v = Vox()
    tall = 3 if kind == "van" else 2
    length = 12 if kind == "van" else 11
    v.box(1, 0, 0, 2, 5, 1, "#222222")
    v.box(length - 3, 0, 0, 2, 5, 1, "#222222")
    v.box(0, 0, 1, length, 5, 2, colour)
    cab_from, cab_len = (1, 8) if kind == "van" else ((1, 7) if kind == "suv" else (2, 6))
    v.box(cab_from, 0, 3, cab_len, 5, tall, colour)
    glass_rows = range(3, 3 + tall - (0 if tall == 2 else 1))
    for i in range(cab_from + 1, cab_from + cab_len - 1):
        for k in glass_rows:
            v.put(i, 4, k, "#bfe3ff")
            v.put(i, 0, k, "#bfe3ff")
    for j in (1, 2, 3):
        for k in glass_rows:
            v.put(cab_from + cab_len - 1, j, k, "#bfe3ff")
            v.put(cab_from, j, k, "#bfe3ff")
    for j in (1, 3):
        v.put(length - 1, j, 2, "#ffe066")
        v.put(0, j, 2, "#e63946")
    for i in (1, 2, length - 3, length - 2):
        v.put(i, 4, 1, "#222222")
        v.put(i, 0, 1, "#222222")
    if kind == "taxi":
        v.box(4, 2, 5, 2, 1, 1, "#ffe066")
    return v


CAR_KINDS = ["sedan", "suv", "taxi", "van"]


def entrance():  # stands on the edge of a lot, the carpet runs along y towards the avenue
    v = Vox()
    v.box(0, 0, 0, 6, 8, 1, "#c1121f")
    for x, y in ((0, 0), (5, 0), (0, 7), (5, 7)):
        v.box(x, y, 1, 1, 1, 6, "#f4d35e")
    for i in range(6):
        v.box(i, 0, 7, 1, 8, 1, "#c1121f" if i % 2 == 0 else WHITE)
    return v


def bank():
    v = Vox()
    v.box(0, 0, -1, 26, 22, 1, PAVING)
    v.box(2, 2, 0, 22, 17, 1, "#dfe7ef")
    v.block(3, 2, 1, 20, 12, 10, "#f1e9d2")
    for i in range(4, 23, 3):
        v.box(i, 16, 1, 1, 1, 9, "#ffffff")
    v.box(3, 14, 10, 20, 4, 1, "#f1e9d2")
    v.roof(2, 1, 11, 22, 18, ["#cfc5a8", "#c4b998"], "x")
    v.box(11, 14, 1, 4, 1, 5, "#7f5539")
    v.cyl(13, 10, 20, 2.6, 1, "#f4d35e")
    v.cyl(13, 10, 21, 2.6, 1, "#eec643")
    v.box(2, 19, 0, 22, 1, 1, "#cfd8e3")
    return v


def townhall():
    v = Vox()
    v.box(0, 0, -1, 28, 22, 1, PAVING)
    v.block(2, 2, 0, 24, 13, 9, "#e9c9a0", glass="#7f5539")
    v.roof(1, 1, 9, 26, 15, ["#c8553d", "#bd4b35"], "x")
    v.block(11, 5, 9, 6, 6, 13, "#e9c9a0", glass="#7f5539", sx=3)
    v.box(13, 10, 17, 2, 1, 2, WHITE)
    v.box(16, 7, 17, 1, 2, 2, WHITE)
    v.pyramid(10, 4, 22, 8, 8, "#5c677d")
    flag(v, 14, 8, 26, 7, "#2a9d8f")
    v.box(12, 15, 0, 4, 3, 1, "#dfe7ef")
    v.box(12, 14, 0, 4, 1, 5, "#7f5539")
    return v


def mountains():
    v = Vox()
    for cx, cy, r, h in ((18, 20, 15, 28), (33, 40, 9, 15), (7, 45, 7, 11), (36, 8, 6, 9)):
        for k in range(h):
            v.cyl(cx, cy, k, max(r * (1 - k / h), 0.7), 1, SNOW if k > h * 0.6 else ROCK + ["#6f7a8c"])
    return v


def lamp():
    v = Vox()
    v.box(0, 0, 0, 1, 1, 8, "#343a40")
    v.box(0, 0, 8, 2, 1, 1, "#343a40")
    v.put(1, 0, 7, "#ffe066")
    return v


def plant(kind, size):
    v = Vox()
    {"tree": tree, "pine": pine, "palm": palm}[kind](v, 0, 0, 0, size)
    return v


PIPS = {1: [(1, 1)], 2: [(0, 0), (2, 2)], 3: [(0, 0), (1, 1), (2, 2)], 4: [(0, 0), (0, 2), (2, 0), (2, 2)],
        5: [(0, 0), (0, 2), (2, 0), (2, 2), (1, 1)], 6: [(0, 0), (0, 1), (0, 2), (2, 0), (2, 1), (2, 2)]}
DIE = 13
SIGNS = {
    "si": ("#2ec46d", [".......", "......#", ".....#.", "#...#..", ".#.#...", "..#....", "......."]),
    "no": ("#e63946", ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"]),
    "gratis": ("#d99a00", ["..###..", ".#...#.", "#..#..#", "#.###.#", "#..#..#", ".#...#.", "..###.."]),
    "doppio": ("#f77f00", ["#.#.##.", ".#....#", "#.#..#.", "....#..", "...#...", "...####", "......."]),
}


def die(body, pip, top):
    v = Vox()
    v.box(0, 0, 0, DIE, DIE, DIE, body)
    for face, value in (("top", top), ("left", 1 + top % 6), ("right", 1 + (top + 2) % 6)):
        for a, b in PIPS[value]:
            for da in (0, 1):
                for db in (0, 1):
                    i, j = 2 + a * 4 + da, 2 + b * 4 + db
                    if face == "top":
                        v.put(i, j, DIE - 1, pip)
                    elif face == "left":
                        v.put(i, DIE - 1, j, pip)
                    else:
                        v.put(DIE - 1, i, j, pip)
    return v


def permit_die(sign):
    v = Vox()
    colour, rows = SIGNS[sign]
    v.box(0, 0, 0, DIE, DIE, DIE, "#fdf6e3")
    v.box(1, 1, DIE - 1, DIE - 2, DIE - 2, 1, colour)
    for j, row in enumerate(rows):
        for i, cell in enumerate(row):
            if cell == "#":
                v.put(3 + i, 3 + j, DIE - 1, WHITE)
    v.box(3, DIE - 1, 3, DIE - 6, 1, DIE - 6, "#2ec46d")
    v.box(DIE - 1, 3, 3, 1, DIE - 6, DIE - 6, "#e63946")
    return v


# ---------------------------------------------------------------- the board

WIDTH, DEPTH = 226, 170   # the playing area: x from 0 to WIDTH, y from 0 to DEPTH
CORNERS = [(50, 50), (176, 50), (176, 120), (50, 120)]  # the avenue; space 0 is the first corner
STEP = 14                 # distance between two spaces
KINDS = ["bank", "buy", "build", "buy", "build", "free", "buy", "build", "buy", "build", "gift", "buy", "build", "buy",
         "municipio", "buy", "build", "buy", "build", "free", "buy", "build", "buy", "build", "gift", "buy", "build", "buy"]
KIND_COLOUR = {"bank": "#ffd23f", "buy": "#2ec46d", "build": "#f77f00", "free": "#35c6f0", "gift": "#ff6fb5",
               "municipio": "#9b5de5"}
KIND_SIGN = {
    "buy": [".####.", "#....#", "#.##.#", "#.##.#", "#....#", ".####."],
    "build": ["######", "######", "..##..", "..##..", "..##..", "..##.."],
    "free": ["#####.", "#...#.", "#...#.", "#..##.", "#...#.", "#####."],
    "gift": ["##..##", ".####.", "######", "#.##.#", "#.##.#", "######"],
    "bank": ["..##..", ".####.", "######", ".#..#.", ".#..#.", "######"],
    "municipio": ["..#...", "..##..", "..#...", ".###..", "#####.", "#####."],
}
GROUND = -4               # z of the top layer of the board; cars drive at GROUND + 1


def space_points():
    points = []
    for n, (x0, y0) in enumerate(CORNERS):
        x1, y1 = CORNERS[(n + 1) % len(CORNERS)]
        steps = (abs(x1 - x0) + abs(y1 - y0)) // STEP
        for s in range(steps):
            points.append((x0 + (x1 - x0) * s // steps, y0 + (y1 - y0) * s // steps))
    return points


def ground():
    v = Vox()
    v.box(-8, -8, GROUND - 3, WIDTH + 16, DEPTH + 16, 1, "#b9ab8a")
    v.box(-8, -8, GROUND - 2, WIDTH + 16, DEPTH + 16, 2, PLINTH)
    v.box(-5, -5, GROUND, WIDTH + 10, DEPTH + 10, 1, GRASS)
    # the sea corner, in front of the lighthouse
    v.box(-5, 112, GROUND, 47, 64, 1, SAND)
    v.box(-5, 128, GROUND, 36, 48, 1, WATER)
    v.box(-5, 172, GROUND, 96, 4, 1, WATER)
    for i in range(30):
        v.put(-4 + int(rnd(i, 41) * 34), 129 + int(rnd(i, 42) * 46), GROUND, WHITE)
    # the car park and the public garden, at the two right corners
    v.box(188, 4, GROUND, 36, 38, 1, ASPHALT)
    for i in range(190, 222, 6):
        v.box(i, 6, GROUND, 1, 12, 1, WHITE)
        v.box(i, 28, GROUND, 1, 12, 1, WHITE)
    for i in range(190, 224):
        for j in range(132, 168):
            if ((i - 207) / 14) ** 2 + ((j - 150) / 12) ** 2 <= 1:
                v.put(i, j, GROUND, WATER)
    # the avenue
    for n, (x0, y0) in enumerate(CORNERS):
        x1, y1 = CORNERS[(n + 1) % len(CORNERS)]
        v.box(min(x0, x1) - 6, min(y0, y1) - 6, GROUND, abs(x1 - x0) + 12, abs(y1 - y0) + 12, 1, PAVING)
    for n, (x0, y0) in enumerate(CORNERS):
        x1, y1 = CORNERS[(n + 1) % len(CORNERS)]
        v.box(min(x0, x1) - 5, min(y0, y1) - 5, GROUND, abs(x1 - x0) + 10, abs(y1 - y0) + 10, 1, ASPHALT)
    for (x, y), kind in zip(space_points(), KINDS):
        v.box(x - 5, y - 5, GROUND, 10, 10, 1, WHITE)
        v.box(x - 4, y - 4, GROUND, 8, 8, 1, KIND_COLOUR[kind])
        for j, row in enumerate(KIND_SIGN[kind]):
            for i, cell in enumerate(row):
                if cell == "#":
                    v.put(x - 3 + i, y - 3 + j, GROUND, WHITE)
    # inside the avenue: the lake
    for i in range(90, 136):
        for j in range(70, 102):
            if ((i - 112.5) / 21) ** 2 + ((j - 85.5) / 13) ** 2 <= 1:
                v.put(i, j, GROUND, WATER)
            elif ((i - 112.5) / 23) ** 2 + ((j - 85.5) / 15) ** 2 <= 1:
                v.put(i, j, GROUND, SAND)
    return v


# ---------------------------------------------------------------- drawing

VIEWS = [0, 2]   # quarter turns of the board for each drawn view
TURNS = 0        # the view being drawn


def turned_cell(x, y, turns):   # where a voxel goes when the board is turned (a quarter turn each time)
    for _ in range(turns):
        x, y = -1 - y, x
    return x, y


def turned_offset(x, y, turns):  # the same for a distance or a point
    for _ in range(turns):
        x, y = -y, x
    return x, y


def turned_rect(rect, turns):
    ax, ay = turned_cell(rect[0], rect[1], turns)
    bx, by = turned_cell(rect[2] - 1, rect[3] - 1, turns)
    return [min(ax, bx), min(ay, by), max(ax, bx) + 1, max(ay, by) + 1]


def lit(c, f):
    return (min(255, int(c[0] * f)), min(255, int(c[1] * f)), min(255, int(c[2] * f)), 255)


def bounds_of(v):
    if TURNS:
        v = v.turned(lambda x, y: turned_cell(x, y, TURNS))
    xs = [(x - y) * 2 for x, y, z in v]
    ys = [(x + y) - 2 * z for x, y, z in v]
    return (min(xs) - 1, min(ys) - 1, max(xs) - min(xs) + 6, max(ys) - min(ys) + 6)


# Returns the picture and the pixel, in the model's own projection, of its top left corner.
def render(v, bounds=None, outline=True):
    min_x, min_y, width, height = bounds or bounds_of(v)
    if TURNS:
        v = v.turned(lambda x, y: turned_cell(x, y, TURNS))
    image = Image.new("RGBA", (width, height))
    px = image.load()
    for x, y, z in sorted(v, key=lambda p: (p[0] + p[1] + p[2], p[2])):
        top = (x, y, z + 1) not in v
        left = (x, y + 1, z) not in v
        right = (x + 1, y, z) not in v
        if not (top or left or right):
            continue
        c = v[(x, y, z)]
        sx, sy = (x - y) * 2 - min_x, (x + y) - 2 * z - min_y
        if top:
            f = 1.06
            if any((x - k, y, z + k) in v for k in range(1, 9)):
                f = 0.78  # in the shadow of something to its left
            elif left or right:
                f = 1.16  # a lit edge
            colour = lit(c, f)
            for a in range(4):
                px[sx + a, sy] = colour
                px[sx + a, sy + 1] = colour
        if left:
            colour = lit(c, 0.84)
            for a in (0, 1):
                px[sx + a, sy + 2] = colour
                px[sx + a, sy + 3] = colour
        if right:
            colour = lit(c, 0.62)
            for a in (2, 3):
                px[sx + a, sy + 2] = colour
                px[sx + a, sy + 3] = colour
    if outline:
        plain = image.copy().load()
        for i in range(width):
            for j in range(height):
                if plain[i, j][3]:
                    continue
                for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if 0 <= i + a < width and 0 <= j + b < height and plain[i + a, j + b][3]:
                        px[i, j] = (24, 22, 38, 255)
                        break
    return image, (min_x, min_y)


def project(x, y, z=0):
    return ((x - y) * 2, x + y - 2 * z)


def save(image, name):
    image.save(os.path.join(OUT, name + ".png"), optimize=True)


def team_colours():
    text = open(os.path.join(ROOT, "src", "web", "shared", "config.js"), encoding="utf-8").read()
    block = text[text.index("COLORS"):text.index("];")]
    return re.findall(r'hex: "(#[0-9a-fA-F]{6})"', block)


def main():
    global TURNS
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    for old in os.listdir(OUT):
        os.remove(os.path.join(OUT, old))

    # where the things that never move stand: (name, model, x, y, z, footprint)
    blocked = [(min(x0, x1) - 7, min(y0, y1) - 7, abs(x1 - x0) + 14, abs(y1 - y0) + 14)
               for (x0, y0), (x1, y1) in zip(CORNERS, CORNERS[1:] + CORNERS[:1])]
    blocked += [(88, 68, 50, 36), (188, 4, 36, 38), (188, 130, 38, 40), (-5, 126, 40, 50), (0, 0, 44, 58)]
    blocked += [(lx - 1, ly - 1, S + 2, S + 2) for _, _, (lx, ly), _, _, _ in HOTELS]
    placed = []

    def stand(name, model, dx, dy, dz, footprint):
        placed.append((name, model, dx, dy, dz, footprint))
        blocked.append((dx - 2, dy - 2, footprint[0] + 4, footprint[1] + 4))

    stand("mountains", mountains(), 0, 0, GROUND + 1, (44, 58))
    stand("bank", bank(), 60, 58, GROUND + 2, (26, 22))
    stand("townhall", townhall(), 140, 90, GROUND + 2, (28, 22))
    points = space_points()
    for n in range(0, len(points), 2):
        x, y = points[n]
        inward_x = 7 if x <= 50 else (-7 if x >= 176 else 0)
        inward_y = 7 if y <= 50 else (-7 if y >= 120 else 0)
        stand("lamp", lamp(), x + inward_x, y + inward_y, GROUND + 1, (1, 1))
    for i in range(700):
        x, y = int(rnd(i, 31) * (WIDTH - 4)) + 1, int(rnd(i, 32) * (DEPTH - 4)) + 1
        if any(bx - 2 <= x < bx + bw + 2 and by - 2 <= y < by + bd + 2 for bx, by, bw, bd in blocked):
            continue
        size = int(rnd(i, 33) * 3)
        if x + y < 150:
            stand("pine-%d" % size, plant("pine", 8 + size * 3), x, y, GROUND + 1, (1, 1))
        elif y > 125 and x < 100:
            stand("palm-%d" % size, plant("palm", 6 + size * 2), x, y, GROUND + 1, (1, 1))
        else:
            stand("tree-%d" % size, plant("tree", 2 + size // 2), x, y, GROUND + 1, (1, 1))

    views = []
    for number, turns in enumerate(VIEWS):
        TURNS = turns
        suffix = "-v%d" % number
        board, origin = render(ground(), outline=False)
        save(board, "ground" + suffix)
        preview = board.copy()

        def place(local, dx, dy, dz=0):
            ox, oy = turned_offset(dx, dy, turns)
            px, py = project(ox, oy, dz)
            return (local[0] + px - origin[0], local[1] + py - origin[1])

        statics = []
        hotels = []
        for index, (model, pieces, (lx, ly), turn, crane_at, crane_height) in enumerate(HOTELS):
            complete = model(pieces)
            crane(complete, crane_at[0], crane_at[1], crane_height)
            bounds = bounds_of(complete.turned(turn))
            tops = []  # first row of each stage's picture with something on it: the name goes just above
            for stage in range(pieces + 1):
                plain = model(stage)
                image, local = render(plain.turned(turn), bounds)
                save(image, "hotel-%d-%d%s" % (index, stage, suffix))
                tops.append(image.getbbox()[1])
                if stage == pieces:
                    final = image
                crane(plain, crane_at[0], crane_at[1], crane_height)
                image, local = render(plain.turned(turn), bounds)
                save(image, "hotel-%d-%d-crane%s" % (index, stage, suffix))
            x, y = place(local, lx, ly)
            hotels.append({"x": x, "y": y, "pieces": pieces, "tops": tops})
            statics.append({"hotel": index, "x": x, "y": y, "r": turned_rect([lx, ly, lx + S, ly + S], turns), "image": final})

        drawn = {}
        for name, model, dx, dy, dz, footprint in placed:
            if name not in drawn:
                drawn[name] = render(model)
                save(drawn[name][0], name + suffix)
            image, local = drawn[name]
            x, y = place(local, dx, dy, dz)
            rect = turned_rect([dx, dy, dx + footprint[0], dy + footprint[1]], turns)
            statics.append({"f": name + suffix, "x": x, "y": y, "r": rect, "image": image})

        # Drawing order: a thing is drawn before another when it lies wholly behind it along x or along y.
        def behind(a, b):
            a_first = a["r"][2] <= b["r"][0] or a["r"][3] <= b["r"][1]
            b_first = b["r"][2] <= a["r"][0] or b["r"][3] <= a["r"][1]
            return a_first and not b_first

        def overlap(a, b):
            return (a["x"] < b["x"] + b["image"].width and b["x"] < a["x"] + a["image"].width and
                    a["y"] < b["y"] + b["image"].height and b["y"] < a["y"] + a["image"].height)

        waiting = sorted(statics, key=lambda s: s["r"][0] + s["r"][1] + s["r"][2] + s["r"][3])
        ordered = []
        while waiting:
            free = [s for s in waiting if not any(o is not s and overlap(o, s) and behind(o, s) for o in waiting)]
            chosen = free[0] if free else waiting[0]
            waiting.remove(chosen)
            ordered.append(chosen)
        for entry in ordered:
            preview.alpha_composite(entry.pop("image"), (entry["x"], entry["y"]))
        preview.save(os.path.join(PREVIEW, "board-%d.png" % number))
        views.append({
            "turns": turns, "origin": list(origin), "size": [board.width, board.height],
            "hotels": hotels, "statics": ordered,
            "lamps": [[s["x"] + 5, s["y"] + 5] for s in ordered if s.get("f", "").startswith("lamp")],
        })

    TURNS = 0
    sprites = {}   # name -> offset of the picture's corner from the projected point it stands on

    def add_sprite(name, model, anchor):
        image, local = render(model)
        save(image, name)
        ax, ay = project(*anchor)
        sprites[name] = [local[0] - ax, local[1] - ay]

    for n, hexa in enumerate(team_colours()):
        model = car(hexa, CAR_KINDS[n % len(CAR_KINDS)])
        length = max(x for x, y, z in model) + 1
        centre = (length / 2, 2.5, 0)
        add_sprite("car-%d-xp" % n, model, centre)
        add_sprite("car-%d-xn" % n, model.turned(lambda x, y: (length - 1 - x, y)), centre)
        add_sprite("car-%d-yp" % n, model.turned(lambda x, y: (y, x)), (2.5, length / 2, 0))
        add_sprite("car-%d-yn" % n, model.turned(lambda x, y: (y, length - 1 - x)), (2.5, length / 2, 0))
        guest = Vox()
        person(guest, 0, 0, 0, hexa)
        add_sprite("person-%d" % n, guest, (0.5, 0.5, 0))
    add_sprite("entrance-y", entrance(), (3, 4, 0))
    add_sprite("entrance-x", entrance().turned(lambda x, y: (y, x)), (4, 3, 0))
    for face in range(1, 7):
        add_sprite("die-%d" % face, die("#f8f9fa", DARK, face), (DIE / 2, DIE / 2, DIE / 2))
    for sign in SIGNS:
        add_sprite("die-" + sign, permit_die(sign), (DIE / 2, DIE / 2, DIE / 2))

    manifest = {"ground": GROUND, "lot": S, "views": views, "sprites": sprites}
    with open(os.path.join(OUT, "board.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, separators=(",", ":"))
    files = os.listdir(OUT)
    print(len(files), "files,", sum(os.path.getsize(os.path.join(OUT, f)) for f in files) // 1024, "KB,",
          len(placed), "standing things")


main()
