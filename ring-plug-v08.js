/**
 * ================================================================
 *  CyTube Ring Plug — ring-plug.js
 *  A living webring for CyTube rooms.
 *  https://github.com/aolcyberchat-gpu/cytube-ring-plug
 * ================================================================
 *  VERSION HISTORY
 *  v0.6  2026-08-12  spy socket: allow polling fallback transport
 *                    (websocket-only was silently failing on CyTube)
 *  v0.5  2026-08-12  spy socket: fixed event names — userlist/
 *                    addUser/userLeave instead of usercount
 *  v0.4  2026-08-11  spy socket: retry until window.io ready
 *                    instead of silently bailing — fixes tooltips
 *                    showing no user count or now playing
 *  v0.3  2026-08-11  registryUrl switched to raw GitHub (no CDN
 *                    cache on ring.json — updates instantly)
 *  v0.2  2026-08-11  fix: prev/next navigation broken — switched
 *                    from <a href> to click → window.location.href
 *  v0.1  2026-08-11  initial release — floating badge style,
 *                    spy sockets for live prev/next room data,
 *                    tooltips, mailto join flow, wallet display
 * ================================================================
 */

(function () {
    'use strict';

    var cfg = Object.assign({
        registryUrl: 'https://raw.githubusercontent.com/aolcyberchat-gpu/cytube-ring-plug/main/ring.json',
        style:       'badge',
        accentColor: '#ff00de',
        goldColor:   '#ffd700',
        bgColor:     'rgba(10,0,20,0.92)',
        wallet:      null,
        home:        null,
        joinEmail:   'andylsixx@proton.me',
        ringName:    'CyTube Ring Plug',
        ringEmoji:   '\u26E7',
        spyPingMs:   30000,
    }, window.CRP_CFG || {});

    var currentRoom = (function () {
        var m = window.location.pathname.match(/^\/r\/([^/?#]+)/i);
        return m ? m[1] : null;
    })();

    if (!currentRoom) return;

    var liveData = {};

    /* ============================================================
       SPY SOCKET — ONE CHANGE FROM v0.3:
       Retry every 500ms until window.io exists instead of
       returning immediately when it isn't ready yet
       ============================================================ */
    function openSpy(roomName, onUpdate) {
        if (!window.io) {
            setTimeout(function () { openSpy(roomName, onUpdate); }, 500);
            return;
        }
        if (liveData[roomName] && liveData[roomName]._socket) return;

        liveData[roomName] = liveData[roomName] || { users: '?', nowPlaying: null, _socket: null };

        try {
            /* Allow polling fallback — websocket-only often fails on CyTube */
            var sock = io('https://cytu.be', {
                forceNew:     true,
                transports:   ['polling', 'websocket'],
                reconnection: true
            });

            sock.on('connect', function () {
                sock.emit('joinChannel', { name: roomName });
            });

            /* userlist fires on join with full array of user objects */
            sock.on('userlist', function (users) {
                liveData[roomName].users = users.length;
                onUpdate(roomName);
            });
            /* addUser / userLeave fire as users come and go */
            sock.on('addUser', function () {
                liveData[roomName].users = (liveData[roomName].users || 0) + 1;
                onUpdate(roomName);
            });
            sock.on('userLeave', function () {
                liveData[roomName].users = Math.max(0, (liveData[roomName].users || 1) - 1);
                onUpdate(roomName);
            });
            sock.on('changeMedia', function (data) {
                liveData[roomName].nowPlaying = data.title || null;
                onUpdate(roomName);
            });
            sock.on('mediaUpdate', function () {});

            var ping = setInterval(function () {
                if (sock.connected) sock.emit('ping');
            }, cfg.spyPingMs);

            sock.on('disconnect', function () {
                clearInterval(ping);
                liveData[roomName]._socket = null;
            });

            liveData[roomName]._socket = sock;

        } catch (e) {
            console.warn('[CRP] spy socket failed for ' + roomName, e);
        }
    }

    function injectStyles() {
        if (document.getElementById('crp-styles')) return;
        var ac  = cfg.accentColor;
        var gld = cfg.goldColor;
        var bg  = cfg.bgColor;

        var css = [
            '#crp-badge{position:fixed;bottom:60px;left:16px;z-index:800;',
            'font-family:"Special Elite",serif,"Segoe UI Emoji",sans-serif;',
            'cursor:pointer;user-select:none}',

            '#crp-icon{width:38px;height:38px;border-radius:50%;',
            'background:' + bg + ';border:2px solid ' + ac + ';',
            'box-shadow:0 0 10px rgba(255,0,222,0.4);',
            'display:flex;align-items:center;justify-content:center;',
            'font-size:20px;transition:box-shadow 0.2s ease;position:relative}',
            '#crp-icon:hover{box-shadow:0 0 18px rgba(255,0,222,0.7)}',

            '#crp-icon::after{content:"";position:absolute;',
            'width:38px;height:38px;border-radius:50%;',
            'border:2px solid ' + ac + ';',
            'animation:crpPulse 2s ease-out infinite;opacity:0}',
            '@keyframes crpPulse{0%{transform:scale(1);opacity:0.6}100%{transform:scale(1.8);opacity:0}}',

            '#crp-panel{position:absolute;bottom:46px;left:0;',
            'background:' + bg + ';border:1px solid ' + ac + ';border-radius:8px;',
            'box-shadow:0 0 20px rgba(255,0,222,0.3);',
            'padding:10px 12px;min-width:220px;',
            'display:none;flex-direction:column;gap:8px}',
            '#crp-badge.crp-open #crp-panel{display:flex}',

            '#crp-panel-title{font-size:11px;color:' + ac + ';letter-spacing:0.08em;',
            'text-transform:uppercase;border-bottom:1px solid rgba(255,0,222,0.2);',
            'padding-bottom:6px;margin-bottom:2px}',

            '#crp-nav{display:flex;gap:6px;align-items:stretch}',

            '.crp-btn{flex:1;display:flex;flex-direction:column;align-items:center;',
            'gap:2px;padding:6px 4px;border-radius:6px;',
            'background:rgba(40,0,55,0.9);border:1px solid rgba(255,0,222,0.3);',
            'color:' + gld + ';font-size:10px;cursor:pointer;transition:all 0.15s ease;',
            'font-family:"Special Elite",serif,"Segoe UI Emoji",sans-serif;position:relative}',
            '.crp-btn:hover{background:rgba(255,0,222,0.18);border-color:' + ac + ';color:#fff;',
            'box-shadow:0 0 8px rgba(255,0,222,0.35)}',
            '.crp-btn .crp-btn-icon{font-size:16px;line-height:1}',
            '.crp-btn.crp-disabled{opacity:0.35;cursor:not-allowed;pointer-events:none}',

            '.crp-btn .crp-tip{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;',
            'transform:translateX(-50%);background:rgba(5,0,15,0.97);',
            'border:1px solid ' + ac + ';border-radius:6px;',
            'padding:7px 10px;min-width:160px;max-width:220px;',
            'font-size:10px;color:#ddd;line-height:1.5;',
            'white-space:normal;z-index:900;pointer-events:none;',
            'box-shadow:0 0 12px rgba(255,0,222,0.25)}',
            '.crp-btn:hover .crp-tip{display:block}',
            '.crp-tip-room{color:' + gld + ';font-size:11px;font-weight:bold;margin-bottom:3px}',
            '.crp-tip-meta{color:rgba(220,220,220,0.7);font-size:10px}',
            '.crp-tip-np{color:' + ac + ';margin-top:3px;font-size:10px}',

            '#crp-wallet{font-size:9px;color:rgba(255,215,0,0.5);',
            'border-top:1px solid rgba(255,0,222,0.15);padding-top:6px;',
            'word-break:break-all;display:flex;align-items:center;gap:4px}',
            '#crp-wallet .crp-wallet-icon{font-size:13px}',
            '#crp-wallet a{color:rgba(255,215,0,0.5);text-decoration:none}',
            '#crp-wallet a:hover{color:' + gld + '}',
        ].join('');

        var s = document.createElement('style');
        s.id = 'crp-styles'; s.textContent = css;
        document.head.appendChild(s);
    }

    function buildTip(room, label) {
        if (!room) {
            return '<div class="crp-tip"><div class="crp-tip-room">Only one room in the ring so far!</div>'
                 + '<div class="crp-tip-meta">Add yours \u2192 click Join</div></div>';
        }
        var live = liveData[room.name] || {};
        return [
            '<div class="crp-tip">',
            '<div class="crp-tip-room">' + label + ': ' + room.name + '</div>',
            '<div class="crp-tip-meta">\uD83D\uDC64 ' + (live.users != null ? live.users : '?') + ' users</div>',
            '<div class="crp-tip-meta">\uD83C\uDF10 ' + room.vibe + '</div>',
            live.nowPlaying ? '<div class="crp-tip-np">\uD83C\uDFB5 ' + live.nowPlaying + '</div>' : '',
            '</div>'
        ].join('');
    }

    function buildBadge(ring, idx) {
        var prev    = ring.length > 1 ? ring[(idx - 1 + ring.length) % ring.length] : null;
        var next    = ring.length > 1 ? ring[(idx + 1) % ring.length] : null;
        var me      = ring[idx];
        var homeUrl = cfg.home || me.url;

        var joinBody = encodeURIComponent(
            'Hi! I\u2019d like to add my CyTube room to the CyTube Ring Plug.\n\n'
          + 'Room name: \nRoom URL: https://cytu.be/r/\nOwner: \nVibe: \nWallet (optional): \n'
        );
        var joinHref = 'mailto:' + cfg.joinEmail
                     + '?subject=' + encodeURIComponent('CyTube Ring Plug \u2014 Join Request')
                     + '&body=' + joinBody;

        var badge = document.createElement('div');
        badge.id = 'crp-badge';

        var icon = document.createElement('div');
        icon.id = 'crp-icon';
        icon.title = cfg.ringName;
        icon.textContent = cfg.ringEmoji;
        icon.addEventListener('click', function (e) {
            e.stopPropagation();
            badge.classList.toggle('crp-open');
        });

        var panel = document.createElement('div');
        panel.id = 'crp-panel';

        var titleEl = document.createElement('div');
        titleEl.id = 'crp-panel-title';
        titleEl.textContent = cfg.ringEmoji + ' ' + cfg.ringName;
        panel.appendChild(titleEl);

        var nav = document.createElement('div');
        nav.id = 'crp-nav';

        function makeBtn(icon2, label, href, tip, disabled) {
            var btn = document.createElement('div');
            btn.className = 'crp-btn' + (disabled ? ' crp-disabled' : '');
            btn.innerHTML = '<span class="crp-btn-icon">' + icon2 + '</span>'
                          + '<span>' + label + '</span>' + tip;
            if (href && !disabled) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    window.location.href = href;
                });
            }
            nav.appendChild(btn);
        }

        makeBtn('\u25C4', 'Prev', prev ? prev.url : null, buildTip(prev, '\u2190'), !prev);
        makeBtn('\uD83C\uDFE0', 'Home', homeUrl, '', false);
        makeBtn('\u25BA', 'Next', next ? next.url : null, buildTip(next, '\u2192'), !next);
        makeBtn('\u002B', 'Join', joinHref,
            '<div class="crp-tip"><div class="crp-tip-room">Join the Ring Plug</div>'
          + '<div class="crp-tip-meta">Sends a pre-filled email to add your room</div></div>',
            false);

        panel.appendChild(nav);

        if (cfg.wallet || me.wallet) {
            var w = cfg.wallet || me.wallet;
            var walletRow = document.createElement('div');
            walletRow.id = 'crp-wallet';
            walletRow.innerHTML = '<span class="crp-wallet-icon">\uD83D\uDCB0</span> ' + w.slice(0,20) + '\u2026';
            panel.appendChild(walletRow);
        }

        badge.appendChild(panel);
        badge.appendChild(icon);

        document.addEventListener('click', function () { badge.classList.remove('crp-open'); });
        panel.addEventListener('click', function (e) { e.stopPropagation(); });
        document.body.appendChild(badge);

        window._crpRefreshTips = function () {
            var btns = nav.querySelectorAll('.crp-btn');
            var pairs = [{ btn: btns[0], room: prev, label: '\u2190' },
                         { btn: btns[2], room: next, label: '\u2192' }];
            pairs.forEach(function (p) {
                if (!p.btn || !p.room) return;
                var old = p.btn.querySelector('.crp-tip');
                var tmp = document.createElement('div');
                tmp.innerHTML = buildTip(p.room, p.label);
                if (old) p.btn.replaceChild(tmp.firstChild, old);
                else p.btn.appendChild(tmp.firstChild);
            });
        };
    }

    function init() {
        if (!document.body) return setTimeout(init, 300);
        injectStyles();
        fetch(cfg.registryUrl)
            .then(function (r) { return r.json(); })
            .then(function (ring) {
                var idx = -1;
                for (var i = 0; i < ring.length; i++) {
                    if (ring[i].name.toLowerCase() === currentRoom.toLowerCase()) {
                        idx = i; break;
                    }
                }
                if (idx === -1) {
                    idx = 0;
                    ring = [{ name: currentRoom, url: window.location.href, owner: '', vibe: '', wallet: null }];
                }
                buildBadge(ring, idx);
                if (ring.length > 1) {
                    var prevRoom = ring[(idx - 1 + ring.length) % ring.length];
                    var nextRoom = ring[(idx + 1) % ring.length];
                    if (prevRoom.name !== currentRoom)
                        openSpy(prevRoom.name, function () { if (window._crpRefreshTips) window._crpRefreshTips(); });
                    if (nextRoom.name !== currentRoom && nextRoom.name !== prevRoom.name)
                        openSpy(nextRoom.name, function () { if (window._crpRefreshTips) window._crpRefreshTips(); });
                }
                window.CRP = { ring: ring, idx: idx, cfg: cfg, liveData: liveData };
            })
            .catch(function (e) { console.warn('[CRP] failed to load registry:', e); });
    }

    (document.readyState === 'complete' || document.readyState === 'interactive')
        ? init()
        : document.addEventListener('DOMContentLoaded', init);

})();
