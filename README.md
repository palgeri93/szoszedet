# Angol szógyakorló

## Excel formátum
Az alkalmazás a data/szavak.xlsx fájlt tölti be. Az új mintát ezen a néven kell elhelyezni.
Munkalaponként választható az évfolyam, azon belül a lecke.

Az új oszlopsorrend:
- A: Lecke
- B: Szám (a mintában üres fejlécet is elfogad, ajánlott: Szám)
- C: Angol szó
- D: Magyar szó

A szám pozitív egész, leckén belül ismétlődhet. Például az 5-ös számhoz tartozhat a man és a men, a 6-oshoz a child és a children. Az 5–6 tartomány mind a négy szót bevonja. A határok beleértendők; a sorok sorrendje és a számozás hézagai nem befolyásolják a szűrést. A fordítva megadott határokat a program felcseréli.

Az új formátumban a szám nélküli sorok kimaradnak, amíg kitöltöd őket. A hibás szám hibaüzenetet ad. A régi, háromoszlopos munkalapok (Lecke, Angol szó, Magyar szó) átmenetileg továbbra is leckén belüli sorszám alapján működnek.

Minden szóváltozat külön kérdezhető. A kérdésszám és az ismétlés nélküli beállítás továbbra is szabályozza, hány kérdés készül; a tartomány az elérhető szavakat jelöli ki.

## Futtatás
Windows alatt az Inditas.cmd fájlra kattints duplán. Ez elindít egy helyi kiszolgálót és megnyitja az alkalmazást a böngészőben. A data/szavak.xlsx automatikusan betöltődik. Az Excel mentése után az oldal frissítésével az új adatokat használja. Az indító Python futtatókörnyezetet igényel; ezen a gépen a Codex meglévő futtatókörnyezetét használja. GitHub Pages-en nincs szükség az indítóra.
Ha dupla kattintással nyitod meg az index.html fájlt, az Excel-fájl betöltése mezőben válaszd ki a szavak.xlsx vagy szavak_uj.xlsx fájlt. A böngésző helyi fájlként megnyitva nem töltheti be automatikusan az Excelt. Webkiszolgálón az automatikus betöltés továbbra is működik.
Tedd fel az index.html, app.js és data/szavak.xlsx fájlokat a repóba. GitHub Settings → Pages → Deploy from a branch → main, /root. Helyben HTTP kiszolgálón keresztül nyisd meg az oldalt.

## Feladattípusok
- Magyar → írd angolul
- Magyar → válaszd az angolt
- Angol → válaszd a magyart
- A három típus véletlen keveréke

Egy helyes válasz egy pont. Az utolsó eredményt név alapján menti a böngésző.
