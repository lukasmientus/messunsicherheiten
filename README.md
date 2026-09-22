# Messdaten-Werkbank

Browser-Applet zum Analysieren von Messreihen, Vergleichen von Messergebnissen und Untersuchen linearer Zusammenhänge mit Unsicherheitsrechtecken. Die Startseite führt über drei Übersichtskacheln zu den Werkzeugen; alle Arbeitsbereiche starten leer.

## Start

`dist/index.html` direkt im Browser öffnen. Für GitHub Pages den Inhalt des Ordners `dist` in die Repository-Wurzel legen oder GitHub Pages auf diesen Ordner konfigurieren.

Alle Messdaten und Berechnungen bleiben im Browser. Es wird kein Backend benötigt. Das offizielle FNW-Logo wird von der OVGU-CD-Seite geladen; ohne Netzwerkverbindung erscheint ein lokaler Text-Fallback. Barlow ist lokal enthalten.

## Enthalten

- Maximalabstand, Ausschließen von Extremwerten, mittlerer frei wählbarer Anteil, MAD und Standardabweichung mit Division durch N
- bekannte Unsicherheit als eigenes Maß
- anklickbare Messpunkte zum manuellen Ausschließen
- automatische fachgerechte Rundung und exakte Werte
- CSV/TXT, Copy-Paste und mehrspaltige Datensätze
- Vergleich zweier Messergebnisse
- x-/y-Unsicherheiten, Unsicherheitsrechtecke, Theoriegerade, Grenzgeraden und Winkelhalbierende
- realistische Beispiele und freie Zufallsdaten
- gekoppelte Zahlenfelder und Schieberegler für didaktisch sinnvolle Parameter
- PNG- und CSV-Export

## Veröffentlichung

Der Ordner `dist` ist vollständig statisch und für GitHub Pages geeignet. `.nojekyll` ist enthalten.
