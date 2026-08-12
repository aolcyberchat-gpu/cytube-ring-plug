/**
 * ================================================================
 *  CyTube Ring Plug — ring-plug-v07.js
 *  A living webring for CyTube rooms.
 *
 *  v0.7 — CCSD TEST
 *  CyTube Cross-Channel Socket Discovery
 *
 *  Phase 1 goal:
 *    Prove that a Ring Plug running in Room A can:
 *
 *      1. fetch /socketconfig/<remote-room>.json
 *      2. discover the correct Socket.IO server
 *      3. establish a second Socket.IO connection
 *      4. join the remote room
 *      5. receive the remote room's userlist
 *
 *  No remote chat/video functionality is being added in this phase.
 *
 * ================================================================
 *  VERSION HISTORY
 *
 *  v0.7  2026-08-12  CCSD test:
 *                    discover remote socket through
 *                    /socketconfig/<room>.json
 *                    instead of hard-coding https://cytu.be
 *
 *  v0.5  2026-08-12  spy socket: fixed event names — userlist/
 *                    addUser/userLeave instead of usercount
 *
 *  v0.4  2026-08-11  spy socket: retry until window.io ready
 *                    instead of silently bailing
 *
 *  v0.3  2026-08-11  registryUrl switched to raw GitHub
 *
 *  v0.2  2026-08-11  fix: prev/next navigation
 *
 *  v0.1  2026-08-11  initial release
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
       CCSD — CyTube Cross-Channel Socket Discovery

       Phase 1:
       Discover the Socket.IO server for the remote channel through:

           /socketconfig/<channel>.json

       The CyTube socket configuration returns:

           {
               "servers": [
                   {
                       "url": "...",
                       "secure": true/false
                   }
               ]
           }

       We prefer the secure server, matching the established
       CyTube client/bot behavior.

       Only after discovering the server do we create the
       secondary Socket.IO connection.
       ============================================================ */

    function getSocketConfigUrl(roomName) {
        /*
         * The Ring Plug runs on cytu.be, so using window.location.origin
         * keeps discovery same-origin.
         *
         * Example:
         *
         * https://cytu.be/socketconfig/Dadders.json
         */
        return window.location.origin
            + '/socketconfig/'
            + encodeURIComponent(roomName)
            + '.json';
    }

    function normalizeSocketServer(serverUrl) {
        if (!serverUrl) return null;

        /*
         * The socket config normally supplies a domain such as:
         *
         *   https://cytu.be
         *
         * Socket.IO then uses:
         *
         *   https://cytu.be/socket.io/
         *
         * If a trailing slash is already present, remove it.
         */
        return String(serverUrl).replace(/\/+$/, '');
    }

    function discoverSocketServer(roomName) {
        var configUrl = getSocketConfigUrl(roomName);

        liveData[roomName] = liveData[roomName] || {
            users: '?',
            nowPlaying: null,
            _socket: null,
            _status: 'config',
            _configUrl: configUrl,
            _socketServer: null,
            _lastEvent: null,
            _error: null
        };

        liveData[roomName]._status = 'config';
        liveData[roomName]._configUrl = configUrl;
        liveData[roomName]._error = null;

        return fetch(configUrl, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        })
        .then(function (response) {
            if (!response.ok) {
                throw new Error(
                    'socketconfig HTTP ' + response.status
                );
            }

            return response.json();
        })
        .then(function (conf) {
            if (!conf || conf.error) {
                throw new Error(
                    conf && conf.error
                        ? String(conf.error)
                        : 'invalid socketconfig response'
                );
            }

            if (!Array.isArray(conf.servers) || !conf.servers.length) {
                throw new Error('socketconfig contains no servers');
            }

            /*
             * Match the established CyTube behavior:
             *
             *   prefer secure server
             *   otherwise use first available server
             */
            var server = null;

            for (var i = 0; i < conf.servers.length; i++) {
                if (conf.servers[i] && conf.servers[i].secure) {
                    server = conf.servers[i];
                    break;
                }
            }

            if (!server) {
                server = conf.servers[0];
            }

            if (!server || !server.url) {
                throw new Error('socketconfig server has no URL');
            }

            var socketServer = normalizeSocketServer(server.url);

            liveData[roomName]._socketServer = socketServer;
            liveData[roomName]._status = 'server';

            return socketServer;
        })
        .catch(function (err) {
            liveData[roomName]._status = 'config-failed';
            liveData[roomName]._error = String(
                err && err.message ? err.message : err
            );

            throw err;
        });
    }

    function openSpy(roomName, onUpdate) {
        if (!window.io) {
            setTimeout(function () {
                openSpy(roomName, onUpdate);
            }, 500);
            return;
        }

        if (liveData[roomName] && liveData[roomName]._socket) {
            return;
        }

        liveData[roomName] = liveData[roomName] || {
            users: '?',
            nowPlaying: null,
            _socket: null,
            _status: 'waiting',
            _configUrl: null,
            _socketServer: null,
            _lastEvent: null,
            _error: null
        };

        /*
         * ========================================================
         * STEP 1
         * Discover the actual Socket.IO server for this room.
         * ========================================================
         */

        discoverSocketServer(roomName)
            .then(function (socketServer) {

                /*
                 * ====================================================
                 * STEP 2
                 * Connect to the discovered Socket.IO server.
                 *
                 * We deliberately use forceNew so this is a separate
                 * connection from CyTube's own main socket.
                 * ====================================================
                 */

                liveData[roomName]._status = 'connecting';
                onUpdate(roomName);

                var socketUrl = socketServer + '/socket.io/';

                var sock = io(socketUrl, {
                    forceNew:   true,
                    transports: ['websocket'],
                    reconnection: true
                });

                /*
                 * Connection succeeded.
                 */
                sock.on('connect', function () {
                    liveData[roomName]._status = 'connected';
                    liveData[roomName]._lastEvent = 'connect';
                    liveData[roomName]._error = null;

                    onUpdate(roomName);

                    /*
                     * =================================================
                     * STEP 3
                     * Ask the newly-created socket to join the
                     * remote CyTube room.
                     *
                     * We are intentionally READ-ONLY in this phase.
                     * =================================================
                     */

                    liveData[roomName]._status = 'joining';
                    onUpdate(roomName);

                    sock.emit('joinChannel', {
                        name: roomName
                    });
                });

                /*
                 * Browser/Socket.IO connection failure.
                 */
                sock.on('connect_error', function (err) {
                    liveData[roomName]._status = 'connection-failed';
                    liveData[roomName]._error =
                        err && err.message
                            ? String(err.message)
                            : String(err);

                    onUpdate(roomName);
                });

                /*
                 * =================================================
                 * STEP 4
                 * The important Phase 1 success event.
                 *
                 * CyTube sends the complete userlist when the
                 * socket joins the channel.
                 * =================================================
                 */

                sock.on('userlist', function (users) {
                    if (!Array.isArray(users)) {
                        liveData[roomName]._status = 'userlist-invalid';
                        liveData[roomName]._error =
                            'userlist was not an array';

                        onUpdate(roomName);
                        return;
                    }

                    liveData[roomName].users = users.length;
                    liveData[roomName]._status = 'userlist';
                    liveData[roomName]._lastEvent = 'userlist';
                    liveData[roomName]._error = null;

                    onUpdate(roomName);
                });

                /*
                 * These are retained from v0.6.
                 *
                 * They are NOT required for declaring Phase 1
                 * successful, but they allow us to see whether the
                 * remote channel continues behaving normally once
                 * the secondary socket is connected.
                 */

                sock.on('addUser', function () {
                    liveData[roomName].users =
                        (liveData[roomName].users || 0) + 1;

                    liveData[roomName]._lastEvent = 'addUser';

                    onUpdate(roomName);
                });

                sock.on('userLeave', function () {
                    liveData[roomName].users =
                        Math.max(
                            0,
                            (liveData[roomName].users || 1) - 1
                        );

                    liveData[roomName]._lastEvent = 'userLeave';

                    onUpdate(roomName);
                });

                /*
                 * Retained for the existing now-playing experiment.
                 */
                sock.on('changeMedia', function (data) {
                    liveData[roomName].nowPlaying =
                        data && data.title
                            ? data.title
                            : null;

                    liveData[roomName]._lastEvent = 'changeMedia';

                    onUpdate(roomName);
                });

                sock.on('mediaUpdate', function () {
                    /*
                     * Intentionally empty for Phase 1.
                     */
                });

                /*
                 * CyTube/server errors.
                 */
                sock.on('error', function (err) {
                    liveData[roomName]._status = 'socket-error';
                    liveData[roomName]._error =
                        err && err.message
                            ? String(err.message)
                            : String(err);

                    onUpdate(roomName);
                });

                /*
                 * Keep the old lightweight heartbeat.
                 */
                var ping = setInterval(function () {
                    if (sock.connected) {
                        sock.emit('ping');
                    }
                }, cfg.spyPingMs);

                /*
                 * Disconnect handling.
                 */
                sock.on('disconnect', function (reason) {
                    clearInterval(ping);

                    liveData[roomName]._socket = null;
                    liveData[roomName]._status = 'disconnected';
                    liveData[roomName]._lastEvent = 'disconnect';
                    liveData[roomName]._error =
                        reason ? String(reason) : null;

                    onUpdate(roomName);
                });

                /*
                 * Store the secondary socket.
                 */
                liveData[roomName]._socket = sock;

                onUpdate(roomName);

            })
            .catch(function (err) {
                /*
                 * discoverSocketServer() has already recorded the
                 * specific config failure.
                 */
                console.warn(
                    '[CRP] CCSD failed for ' + roomName,
                    err
                );

                onUpdate(roomName);
            });
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function ccsdStatusText(live) {
        if (!live) return 'CCSD: waiting';

        switch (live._status) {
            case 'config':
                return '🔌 CCSD: discovering socket…';

            case 'server':
                return '🔌 CCSD: server discovered';

            case 'connecting':
                return '🔌 CCSD: connecting…';

            case 'connected':
                return '🔌 CCSD: connected';

            case 'joining':
                return '🔌 CCSD: joining room…';

            case 'userlist':
                return '🔌 CCSD: userlist ✓';

            case 'config-failed':
                return '🔌 CCSD: config FAILED';

            case 'connection-failed':
                return '🔌 CCSD: connection FAILED';

            case 'userlist-invalid':
                return '🔌 CCSD: bad userlist';

            case 'socket-error':
                return '🔌 CCSD: socket ERROR';

            case 'disconnected':
                return '🔌 CCSD: disconnected';

            default:
                return '🔌 CCSD: ' + live._status;
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

            '.crp-tip-ccsd{color:#aaa;margin-top:4px;font-size:9px}',

            '#crp-wallet{font-size:9px;color:rgba(255,215,0,0.5);',
            'border-top:1px solid rgba(255,0,222,0.15);padding-top:6px;',
            'word-break:break-all;display:flex;align-items:center;gap:4px}',

            '#crp-wallet .crp-wallet-icon{font-size:13px}',

            '#crp-wallet a{color:rgba(255,215,0,0.5);text-decoration:none}',

            '#crp-wallet a:hover{color:' + gld + '}'

        ].join('');

        var s = document.createElement('style');

        s.id = 'crp-styles';
        s.textContent = css;

        document.head.appendChild(s);
    }

    function buildTip(room, label) {
        if (!room) {
            return '<div class="crp-tip">'
                 + '<div class="crp-tip-room">'
                 + 'Only one room in the ring so far!'
                 + '</div>'
                 + '<div class="crp-tip-meta">'
                 + 'Add yours → click Join'
                 + '</div>'
                 + '</div>';
        }

        var live = liveData[room.name] || {};

        var status = ccsdStatusText(live);

        var error = live._error
            ? '<div class="crp-tip-ccsd">'
              + escapeHtml(live._error)
              + '</div>'
            : '';

        return [
            '<div class
