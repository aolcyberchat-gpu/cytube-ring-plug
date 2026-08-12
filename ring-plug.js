/**
 * ================================================================
 *  CyTube Ring Plug — ring-plug.js
 *  A living webring for CyTube rooms.
 *  https://github.com/aolcyberchat-gpu/cytube-ring-plug
 * ================================================================
 *  VERSION HISTORY
 *  v0.2  2026-08-11  fix: prev/next navigation broken — switched
 *                    from <a href> (blocked by mobile browsers on
 *                    injected scripts) to click → window.location.href
 *  v0.1  2026-08-11  initial release — floating badge style,
 *                    spy sockets for live prev/next room data,
 *                    tooltips, mailto join flow, wallet display
 * ================================================================
 *
 *  SETUP (room owner):
 *  1. Add your room to ring.json and commit to GitHub
 *  2. In your room's External Javascript, load this file:
 *       https://cdn.jsdelivr.net/gh/aolcyberchat-gpu/
 *               cytube-ring-plug@main/ring-plug.js
 *  3. Optionally override CRP.cfg in your own room script
 *     BEFORE this file loads, e.g.:
 *       window.CRP_CFG = {
 *           style:  'badge',   // 'badge' | 'bar' | 'sidebar'
 *           wallet: 'bc1q...',
 *           home:   'https://mysite.example.com'
 *       };
 *
 *  REGISTRY (ring.json schema):
 *  [
 *    {
 *      "name":   "MySpace",               // must match cytu.be/r/NAME exactly
 *      "url":    "https://cytu.be/r/MySpace",
 *      "owner":  "Andy L. Sixx",
 *      "vibe":   "mallgoth / 2000s nostalgia",
 *      "wallet": "bc1q..."                // null to hide
 *    }, ...
 *  ]
 * ================================================================
 */

(function () {
    'use strict';

    /* ============================================================
       CONFIG — page owners override via window.CRP_CFG
       ============================================================ */
    var cfg = Object.assign({
        registryUrl: 'https://cdn.jsdelivr.net/gh/aolcyberchat-gpu/cytube-ring-plug@main/ring.json',
        style:       'badge',          // 'badge' | 'bar' | 'sidebar' (bar + sidebar coming v0.2)
        accentColor: '#ff00de',        // neon pink default
        goldColor:   '#ffd700',
        bgColor:     'rgba(10,0,20,0.92)',
        wallet:      null,             // your tip address, or null to hide
        home:        null,             // your homepage URL, or null to use room URL
        joinEmail:   'andylsixx@proton.me',
        ringName:    'CyTube Ring Plug',
        ringEmoji:   '\u26E7',         // ⛧ sigil of the ring
        spyPingMs:   30000,            // keepalive interval for spy sockets
    }, window.CRP_CFG || {});

    /* ============================================================
       DETECT CURRENT ROOM
       e.g. https://cytu.be/r/MySpace → "MySpace"
       ============================================================ */
    var currentRoom = (function () {
        var m = window.location.pathname.match(/^\/r\/([^/?#]+)/i);
        return m ? m[1] : null;
    })();

    if (!currentRoom) return; // not on a room page, bail

    /* ============================================================
       LIVE DATA STORE — populated by spy sockets
       ============================================================ */
    var liveData = {};
    // liveData['RoomName'] = { users: 0, nowPlaying: 'Nothing', title: '' }

    /* ============================================================
       SPY SOCKET — connect to a room as a read-only observer
       Listens for: usercount, changeMedia, queue
       Sends keepalive ping every cfg.spyPingMs ms
       ============================================================ */
    function openSpy(roomName, onUpdate) {
        if (!window.io) return; // socket.io not loaded yet, skip
        if (liveData[roomName] && liveData[roomName]._socket) return; // already open

        liveData[roomName] = liveData[roomName] || { users: '?', nowPlaying: '…', _socket: null };

        try {
            var sock = io('https://cytu.be', {
                forceNew:  true,
                transports: ['websocket'],
                reconnection: true
            });

            sock.on('connect', function () {
                sock.emit('joinChannel', { name: roomName });
            });

            sock.on('usercount', function (count) {
                liveData[roomName].users = count;
                onUpdate(roomName);
            });

            sock.on('changeMedia', function (data) {
                liveData[roomName].nowPlaying = data.title || 'Unknown';
                onUpdate(roomName);
            });

            sock.on('mediaUpdate', function (data) {
                // currentTime updates — we don't need these, ignore
            });

            // Keepalive — prevents server-side timeout
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

    /* ============================================================
       STYLES
       ============================================================ */
    function injectStyles() {
        if (document.getElementById('crp-styles')) return;
        var ac  = cfg.accentColor;
        var gld = cfg.goldColor;
        var bg  = cfg.bgColor;

        var css = [
            /* ---- Floating badge ---- */
            '#crp-badge{',
            'position:fixed;bottom:60px;left:16px;z-index:800;',
            'font-family:"Special Elite",serif,"Segoe UI Emoji",sans-serif;',
            'cursor:pointer;user-select:none}',

            /* Collapsed pill — just the sigil */
            '#crp-icon{',
            'width:38px;height:38px;border-radius:50%;',
            'background:' + bg + ';',
            'border:2px solid ' + ac + ';',
            'box-shadow:0 0 10px rgba(255,0,222,0.4);',
            'display:flex;align-items:center;justify-content:center;',
            'font-size:20px;transition:box-shadow 0.2s ease;',
            'position:relative}',
            '#crp-icon:hover{box-shadow:0 0 18px rgba(255,0,222,0.7)}',

            /* Pulse ring on icon to draw attention */
            '#crp-icon::after{content:"";position:absolute;',
            'width:38px;height:38px;border-radius:50%;',
            'border:2px solid ' + ac + ';',
            'animation:crpPulse 2s ease-out infinite;opacity:0}',
            '@keyframes crpPulse{0%{transform:scale(1);opacity:0.6}',
            '100%{transform:scale(1.8);opacity:0}}',

            /* Expanded panel */
            '#crp-panel{',
            'position:absolute;bottom:46px;left:0;',
            'background:' + bg + ';',
            'border:1px solid ' + ac + ';border-radius:8px;',
            'box-shadow:0 0 20px rgba(255,0,222,0.3);',
            'padding:10px 12px;min-width:220px;',
            'display:none;flex-direction:column;gap:8px}',
            '#crp-badge.crp-open #crp-panel{display:flex}',

            /* Panel header */
            '#crp-panel-title{',
            'font-size:11px;color:' + ac + ';letter-spacing:0.08em;',
            'text-transform:uppercase;border-bottom:1px solid rgba(255,0,222,0.2);',
            'padding-bottom:6px;margin-bottom:2px}',

            /* Nav buttons row */
            '#crp-nav{display:flex;gap:6px;align-items:stretch}',

            '.crp-btn{',
            'flex:1;display:flex;flex-direction:column;align-items:center;',
            'gap:2px;padding:6px 4px;border-radius:6px;',
            'background:rgba(40,0,55,0.9);',
            'border:1px solid rgba(255,0,222,0.3);',
            'color:' + gld + ';font-size:10px;text-decoration:none;',
            'cursor:pointer;transition:all 0.15s ease;',
            'font-family:"Special Elite",serif,"Segoe UI Emoji",sans-serif;',
            'position:relative}',
            '.crp-btn:hover{background:rgba(255,0,222,0.18);',
            'border-color:' + ac + ';color:#fff;',
            'box-shadow:0 0 8px rgba(255,0,222,0.35)}',
            '.crp-btn .crp-btn-icon{font-size:16px;line-height:1}',
            '.crp-btn.crp-disabled{opacity:0.35;cursor:not-allowed;pointer-events:none}',

            /* Tooltip */
            '.crp-btn .crp-tip{',
            'display:none;position:absolute;bottom:calc(100% + 8px);left:50%;',
            'transform:translateX(-50%);',
            'background:rgba(5,0,15,0.97);',
            'border:1px solid ' + ac + ';border-radius:6px;',
            'padding:7px 10px;min-width:160px;max-width:220px;',
            'font-size:10px;color:#ddd;line-height:1.5;',
            'white-space:normal;z-index:900;pointer-events:none;',
            'box-shadow:0 0 12px rgba(255,0,222,0.25)}',
            '.crp-btn:hover .crp-tip{display:block}',
            '.crp-tip-room{color:' + gld + ';font-size:11px;font-weight:bold;margin-bottom:3px}',
            '.crp-tip-meta{color:rgba(220,220,220,0.7);font-size:10px}',
            '.crp-tip-np{color:' + ac + ';margin-top:3px;font-size:10px}',

            /* Wallet row */
            '#crp-wallet{',
            'font-size:9px;color:rgba(255,215,0,0.5);',
            'border-top:1px solid rgba(255,0,222,0.15);',
            'padding-top:6px;word-break:break-all;',
            'display:flex;align-items:center;gap:4px}',
            '#crp-wallet .crp-wallet-icon{font-size:13px}',
            '#crp-wallet a{color:rgba(255,215,0,0.5);text-decoration:none}',
            '#crp-wallet a:hover{color:' + gld + '}',

        ].join('');

        var s = document.createElement('style');
        s.id = 'crp-styles'; s.textContent = css;
        document.head.appendChild(s);
    }

    /* ============================================================
       BUILD TOOLTIP HTML
       ============================================================ */
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
            live.nowPlaying
                ? '<div class="crp-tip-np">\uD83C\uDFB5 ' + live.nowPlaying + '</div>'
                : '',
            '</div>'
        ].join('');
    }

    /* ============================================================
       BUILD WIDGET
       ============================================================ */
    function buildBadge(ring, idx) {
        var prev = ring.length > 1 ? ring[(idx - 1 + ring.length) % ring.length] : null;
        var next = ring.length > 1 ? ring[(idx + 1) % ring.length] : null;
        var me   = ring[idx];
        var homeUrl = cfg.home || me.url;

        // Join mailto
        var joinBody = encodeURIComponent(
            'Hi! I\u2019d like to add my CyTube room to the CyTube Ring Plug.\n\n'
          + 'Room name: \n'
          + 'Room URL: https://cytu.be/r/\n'
          + 'Owner: \n'
          + 'Vibe / description: \n'
          + 'Tip wallet (optional): \n'
        );
        var joinHref = 'mailto:' + cfg.joinEmail
                     + '?subject=' + encodeURIComponent('CyTube Ring Plug \u2014 Join Request')
                     + '&body=' + joinBody;

        // Root badge element
        var badge = document.createElement('div');
        badge.id = 'crp-badge';

        // Collapsed icon
        var icon = document.createElement('div');
        icon.id = 'crp-icon';
        icon.title = cfg.ringName;
        icon.textContent = cfg.ringEmoji;
        icon.addEventListener('click', function (e) {
            e.stopPropagation();
            badge.classList.toggle('crp-open');
        });

        // Expanded panel
        var panel = document.createElement('div');
        panel.id = 'crp-panel';

        // Title
        var title = document.createElement('div');
        title.id = 'crp-panel-title';
        title.textContent = cfg.ringEmoji + ' ' + cfg.ringName;
        panel.appendChild(title);

        // Nav row
        var nav = document.createElement('div');
        nav.id = 'crp-nav';

        // Helper: make a nav button
        function makeBtn(icon2, label, href, tip, disabled) {
            var btn = document.createElement('div');
            btn.className = 'crp-btn' + (disabled ? ' crp-disabled' : '');
            btn.innerHTML = '<span class="crp-btn-icon">' + icon2 + '</span>'
                          + '<span>' + label + '</span>'
                          + tip;
            if (href && !disabled) {
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    // mailto opens in mail client, everything else same tab
                    if (href.indexOf('mailto:') === 0) {
                        window.location.href = href;
                    } else {
                        window.location.href = href;
                    }
                });
            }
            nav.appendChild(btn);
        }

        makeBtn('\u25C4', 'Prev',  prev ? prev.url : null, buildTip(prev, '\u2190'), !prev);
        makeBtn('\uD83C\uDFE0', 'Home',  homeUrl, '', false);
        makeBtn('\u25BA', 'Next',  next ? next.url : null, buildTip(next, '\u2192'), !next);
        makeBtn('\u002B', 'Join',  joinHref, '<div class="crp-tip"><div class="crp-tip-room">Join the Ring Plug</div><div class="crp-tip-meta">Sends a pre-filled email to add your room</div></div>', false);

        panel.appendChild(nav);

        // Wallet row
        if (cfg.wallet || me.wallet) {
            var w = cfg.wallet || me.wallet;
            var walletRow = document.createElement('div');
            walletRow.id = 'crp-wallet';
            walletRow.innerHTML = '<span class="crp-wallet-icon">\uD83D\uDCB0</span>'
                                + '<a href="javascript:void(0)" title="' + w + '" '
                                + 'onclick="navigator.clipboard&&navigator.clipboard.writeText(\'' + w + '\')'
                                + '.then(function(){this.textContent=\'Copied!\';var t=this;setTimeout(function(){t.textContent=\'' + w.slice(0,16) + '\u2026\'},1200)}).catch(function(){})" >'
                                + w.slice(0, 16) + '\u2026</a>';
            panel.appendChild(walletRow);
        }

        badge.appendChild(panel);
        badge.appendChild(icon);

        // Close panel when clicking outside
        document.addEventListener('click', function () {
            badge.classList.remove('crp-open');
        });
        panel.addEventListener('click', function (e) { e.stopPropagation(); });

        document.body.appendChild(badge);

        // Expose update function so spy sockets can refresh tooltips
        window._crpRefreshTips = function () {
            var prevTipEl = nav.querySelectorAll('.crp-btn')[0];
            var nextTipEl = nav.querySelectorAll('.crp-btn')[2];
            if (prevTipEl) prevTipEl.querySelector('.crp-tip') &&
                (prevTipEl.querySelector('.crp-tip').outerHTML = buildTip(prev, '\u2190'));
            if (nextTipEl) nextTipEl.querySelector('.crp-tip') &&
                (nextTipEl.querySelector('.crp-tip').outerHTML = buildTip(next, '\u2192'));
        };
    }

    /* ============================================================
       MAIN — fetch registry, find self, build widget, open spies
       ============================================================ */
    function init() {
        if (!document.body) return setTimeout(init, 300);

        injectStyles();

        fetch(cfg.registryUrl)
            .then(function (r) { return r.json(); })
            .then(function (ring) {
                // Find this room in the ring (case-insensitive)
                var idx = -1;
                for (var i = 0; i < ring.length; i++) {
                    if (ring[i].name.toLowerCase() === currentRoom.toLowerCase()) {
                        idx = i; break;
                    }
                }

                if (idx === -1) {
                    // Room not in ring yet — show join-only badge
                    idx = 0;
                    ring = [{
                        name:   currentRoom,
                        url:    window.location.href,
                        owner:  '',
                        vibe:   '',
                        wallet: cfg.wallet || null
                    }];
                }

                buildBadge(ring, idx);

                // Open spy sockets for prev and next rooms
                if (ring.length > 1) {
                    var prevRoom = ring[(idx - 1 + ring.length) % ring.length];
                    var nextRoom = ring[(idx + 1) % ring.length];

                    if (prevRoom.name !== currentRoom) {
                        openSpy(prevRoom.name, function () {
                            if (window._crpRefreshTips) window._crpRefreshTips();
                        });
                    }
                    if (nextRoom.name !== currentRoom && nextRoom.name !== prevRoom.name) {
                        openSpy(nextRoom.name, function () {
                            if (window._crpRefreshTips) window._crpRefreshTips();
                        });
                    }
                }

                // Expose for debugging
                window.CRP = {
                    ring:    ring,
                    idx:     idx,
                    cfg:     cfg,
                    liveData: liveData
                };

            })
            .catch(function (e) {
                console.warn('[CRP] failed to load registry:', e);
            });
    }

    (document.readyState === 'complete' || document.readyState === 'interactive')
        ? init()
        : document.addEventListener('DOMContentLoaded', init);

})();
