/*
      
MIT License

Copyright (c) 2020 Alex Morgan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

      Style guide:
      Variable names, function names, and method names are camelCase. 
      An exception to this: when a variable name matches a rest query parameter; e.g. direction_id
      Class names are UpperCamelCase.
      Minimize global (file-scope) variables.
      Instances of Vue are global. The name of a Vue ends in Vue.
      Names of other global variables start with global.
      No tabs; indentation is 2 spaces.
    */
    var globalAudio = null;  
    /* Keep track of WHEN the GlobalAudioContext is supposed to be playing beeps, so that we can avoid overlapping
     them in time (because the result of overlapping is hideous to the ear.) */
    var globalAudioOffsetTime = null;
    /* Code to save our personal settings in local storage. 
       More convenient than cookies. */
    function setStorageString(key, cvalue) {
      window.localStorage.setItem(key, encodeURIComponent(cvalue));
    }
    function getStorageString(key) {
      var value = window.localStorage.getItem(key);
      value = decodeURIComponent(value);
      return value;
    }
    function getStorageData(key) {
      let str = getStorageString(key);
      if (str) {
        try {
          return JSON.parse(str);
        }
        catch (err) {
          console.log("problem with json encoding?: " + str + " " + err);
        }
      }
      return null;
    }
    Array.prototype.swap = function (x,y) {  
      // credit to Stefan in https://stackoverflow.com/questions/872310/javascript-swap-array-elements
      if (x < 0) return this;
      if (y < 0) return this; 
      if (x >= this.length) return this;
      if (y >= this.length) return this;
      if (x == y) return this;
      var b = this[x];
      this[x] = this[y];
      this[y] = b;
      return this;
    }  
    function getMBTAHeaders() {
      // get a working MBTA key here: https://api-v3.mbta.com/portal
      return { "X-API-Key": globalMBTAKey }
    }
    /* utility functions */
    function pretty(obj) {
      return JSON.stringify(obj, undefined, 4);
    }
    function minutesAndSeconds(diff) {  // diff given in ms
      if (diff < 500) {   // Includes cases where diff is negative, which does happen
        return "NOW";
      }
      diff = Math.floor(diff / 1000); // in seconds
      let minutes = Math.floor(diff / 60); // in minutes
      let seconds = diff % 60;
      var str = "" + minutes + " minutes";
      if (minutes < 10) {
        str = str + ", " + seconds + " seconds";
      }
      return str;
    }
    // argument: a 24-hour time string of format hh:mm
    // returns: number of minutes since midnight
    function timeStringToMinutes(str) {
      if ((typeof str) != "string") return 0;
      let fields = str.split(":");
      return 60*parseInt(fields[0]) + parseInt(fields[1]);
    }
    var globalTransitTypeLookup = {};  // given a route id, is it a bus, boat,...
    function tickTime() {
      let now = new Date();
      transitWatchVue.nowTime = now;
      timeDisplayVue.nowTime = now;
    }
    class Transit {
      constructor(settings) {
        this.settings = settings;
        this.soonest = 'No service';
        this.soonestBusStyleObject = null;
        this.lastSuccessfulFetch = null;
        this.errorText = '';
        this.rawww = 'no data';
        this.alertBanner = '';
        this.alertDetail = '';
        this.showFullAlert = false;
        this.times = [];
        this.lastMod = null;
        this.showDetail = true;
        this.doBeep = false;
        this.showSettings = false;
        this.nextBusWidthClass = "col-11";
      };
      /* Some ad-hoc cleanup of the transit object after it's had its settings filled in with what was found in
         local storage. Generally we trust what's in local storage, because this page is the only one touching its
         own local storage... Ideally, if we were being really defensive, there'd be validation of everything fetched
         from local storage. 
         Even if we trust local storage to be only what we've written there, have a place to validate, so that we can
         recover from bugs in previous in the page that might have created bad settings! 
      */
      validateTransitSettings(vm) {
        if (this.settings.repeatInterval < vm.$data.minBeepRepeatInterval) {
          this.settings.repeatInterval = vm.$data.minBeepRepeatInterval;
        } 
        let tp = new RegExp('[0-9][0-9]:[0-9][0-9]');
        if (((typeof this.settings.minBeepTime) != "string") || !this.settings.minBeepTime.match(tp)) {
          this.settings.minBeepTime = "07:30";
        }
        if ((typeof this.settings.maxBeepTime) != "string" || !this.settings.maxBeepTime.match(tp)) {
          this.settings.maxBeepTime = "09:30";
        }
        if ((typeof this.settings.earlyTime) != "string" || !this.settings.earlyTime.match(tp)) {
          this.settings.earlyTime = "08:30";
        }
        if ((this.settings.greenMinutes === undefined) || (this.settings.greenMinutes === "")) {
          this.settings.greenMinutes = 15;
        }
        if ((this.settings.yellowMinutes === undefined) || (this.settings.yellowMinutes === "")) {
          this.settings.yellowMinutes = 10;
        }
        if ((this.settings.redMinutes === undefined) || (this.settings.redMinutes === "")) {
          this.settings.redMinutes = 5;
        }
        this.settings.greenMinutes = parseInt(this.settings.greenMinutes);
        this.settings.yellowMinutes = parseInt(this.settings.yellowMinutes);
        this.settings.redMinutes = parseInt(this.settings.redMinutes);
        this.applyAlertTimeConstraints();
        if (!this.settings.immediateThreshold || (this.settings.immediateThreshold < 1)) {
          this.settings.immediateThreshold = 1;
        }
      };
      applyAlertTimeConstraints() {
        /* Here's a useful idiom:
           The do-while loop looks either scary (like it will loop endlessly) or degenerate (like it will
            loop only once). However, N.B. that it doesn't loop endlessly because we have a break as the
            last line in the loop; and it may loop more than once, because we have a continue statement.
            Whenever we change anything, go back to the top of the loop and re-run all the checks, via continue.
            Whenever we get through a whole iteration without hitting a continue, break.
            Of course, the continue in the first conditional block is superfluous; but I put it in for consistency,
            and safety, in case you rearrange checks or copy/paste carelessly etc.
        */
        do {
          if (this.settings.greenMinutes < 0) {
            this.settings.greenMinutes = 0; continue;
          }
          if (this.settings.yellowMinutes < 0) {
            this.settings.yellowMinutes = 0; continue;
          }
          if (this.settings.redMinutes < 0) {
            this.settings.redMinutes = 0; continue;
          }
          if (this.settings.greenMinutes < this.settings.yellowMinutes) {
            this.settings.greenMinutes = this.settings.yellowMinutes;  continue;  
          }  
          if (this.settings.yellowMinutes < this.settings.redMinutes) {
            this.settings.yellowMinutes = this.settings.redMinutes;  continue;
          }
          break;
        } while (true);
      }
      fetchAndProcess() {
        console.log('fetching ' + this.settings.route);
        let myHeaders = getMBTAHeaders();
        if (this.lastMod) {
          myHeaders['If-Modified-Since'] = this.lastMod;
        }
        var url = "https://api-v3.mbta.com//predictions?filter[stop]=" + this.settings.stop 
                + "&filter[direction_id]=" + this.settings.direction_id
                + "&sort=time";
        let aPromise = axios.get(url, {  headers: myHeaders });
        aPromise.then(response => this.digestResponse(response), error => this.dealWithError(error) );
      };
      dealWithError(error) {
        if (error.response && 
              error.response.status == 304) { // this is actually awesome! MBTA sez data hasn't changed
          this.lastSuccessfulFetch = Date.now();  // really actually this was a successful query
          return; 
        }                      
        let now = Date.now();
        if (this.lastSuccessfulFetch != null) {
          var msSinceLast = now - this.lastSuccessfulFetch;
          if (msSinceLast < 5*1000) {
            return;   // ignore brief network glitches
          }
        } 
        this.errorText = error;  
      }
      digestResponse(response) {
        var now = Date.now();
        var data = response.data.data;
        var i;
//      this.rawww = pretty(response.data.data);
        this.times = [];
        for (i = 0; i < data.length; i = i + 1) {
          var anArrival = data[i];
          var predictedTime = null;
          if (anArrival.relationships == null) continue;
          if (anArrival.relationships.route == null) continue;
          if (anArrival.relationships.route.data == null) continue;
          if (anArrival.relationships.route.data.id != this.settings.route) continue;
          if (anArrival.attributes.direction_id != this.settings.direction_id) continue;
          if (anArrival.attributes != null) {
            if (anArrival.attributes.departure_time == null ) {
              // According to MBTA documentation: prediction is of arrival time
              // to a FINAL end of line stop, so not of interest to customers.
              continue;
            }
            if (anArrival.attributes.arrival_time == null) {
              predictedTime = anArrival.attributes.departure_time; // first stop
            }
            else {
              predictedTime = anArrival.attributes.arrival_time; // mid-route stop
            }
            if (predictedTime != null) {
              this.times.push(predictedTime);
            }   // END if a time useful for predictedTime in found attributes
          }    // END if attributes for this record
        }  // END for
        this.lastSuccessfulFetch = Date.now();                
        this.lastMod = response.headers['last-modified'];
        this.errorText = '';
        tickTime();  
      };
      digestAlert(data) {
//        this.rawww = data[0];
        this.alertBanner = '';
        this.alertDetail = '';
        var j;
        for (j = 0; j < data.length; ++j) {
          let item = data[j];
          if (item.attributes.banner) { 
            this.alertBanner += item.attributes.banner.substring(0,60);
            this.alertDetail += item.attributes.banner;
          }
          if (item.attributes.header) {
            let snippit = item.attributes.header.substring(0,50);
            if (this.alertBanner.search(snippit) == -1) {
              this.alertBanner += ' ';
              this.alertBanner += snippit;
            }
            if (this.alertDetail.search(item.attributes.header) == -1) {
              this.alertDetail += ' ';
              this.alertDetail += item.attributes.header;     
            }
          }
          if (item.attributes.description) {
            if (this.alertDetail.search(item.attributes.description) == -1 ) {
              this.alertDetail += ' ';
              this.alertDetail += item.attributes.description;
            }
          }
          this.alertBanner += " ";
          this.alertDetails += " ";
        }
      };
      tickTime(now) {  // update display based on how soon next bus is
        var color = "#FFFFFF";
        var soonestArrivalTime = null;  // pick out first time in prediction array that's not too immeidate
        var j;
        for (j = 0; j < this.times.length; ++j) {
          let anArrivalTime = Date.parse(this.times[j]);  //ms since epoch
          if (this.settings.ignoreImmediateBusses) {
            if ((anArrivalTime - now.getTime()) < this.settings.immediateThreshold*60*1000) {
              continue;  // too soon-- ignore this bus, and consider the next one
            }
          }
          if (this.settings.ignoreEarlyBusses && this.settings.earlyTime) {
            let earlyTimeInMin = timeStringToMinutes(this.settings.earlyTime);
            let fields = this.times[j].split("T");
            let transitTime = timeStringToMinutes(fields[1]);
            if (transitTime < earlyTimeInMin) {
              continue; // we are not interested in any bus that comes THAT early
            }
          }
          soonestArrivalTime = anArrivalTime;  break;  // this time will do
        }
        var shouldBeep = false;
        if (soonestArrivalTime == null) {
          this.soonest = 'no ' + this.settings.transitType;
        }
        else {
          let ms = soonestArrivalTime - now.getTime();
          this.soonest =  minutesAndSeconds(ms);
          let minutes = ms / (1000*60);  // minutes is a number. So numeric comparison works below.
          if (minutes < this.settings.greenMinutes) {
            if (minutes < this.settings.yellowMinutes) {
              if (minutes < this.settings.redMinutes) {
                if (ms < -60 && !this.settings.ignoreImmediateBusses && this.settings.immediateThreshold) {
                  this.fetchAndProcess();   // bus is overdue; did it go yet???
                }
                color = "OrangeRed";  
              }
              else {   // within the "yellow" time range: time to get out the door
                color = "yellow";  
                if (this.doBeep) {
                  let nowMinutes = now.getHours()*60+now.getMinutes();
                  if (nowMinutes >= timeStringToMinutes(this.settings.minBeepTime) &&
                     nowMinutes <= timeStringToMinutes(this.settings.maxBeepTime)) {
                    shouldBeep = true;
                  }
                }
              }
            }
            else {      color = "Lime";}
          }
        }  // END there is a predicted time
        this.soonestBusStyleObject = { backgroundColor: color  }
        this.setUpBeeps(shouldBeep);
      };
      setUpBeeps(shouldBeep) {
        if (shouldBeep) {
          if (!this.beepTimerId) {
            let now = new Date();
            if ((this['prevBeepTime']) && ((now - this['prevBeepTime']) < this.settings.repeatInterval*1000)) {
              // Previous beep was less than repeatInterval seconds ago
              // Figure out time until next beep according to current repeat interval, and start the beep train then
              let delay = (this.settings.repeatInterval*1000) - (now - this['prevBeepTime']);
              this.beepTimerId = setTimeout(this.constructor.makeStartBeepFunction(this), delay);
            }
            else {  // start beeps immediately
              this.startBeeps();
            }  
          } 
        }
        else {
          if (this.beepTimerId) {
            clearInterval(this.beepTimerId);
            this.beepTimerId = null;
          }
        }
      }
      static makeBeepFunction(transit) {
        return function() {
          transit.playBeep();
        };
      };
      static makeStartBeepFunction(transit) {
        return function() {
          transit.startBeeps();
        };
      };
      startBeeps() {
        this.playBeep();
        this.beepTimerId = setInterval(
            this.constructor.makeBeepFunction(this), this.settings.repeatInterval*1000);
      };
      playBeep() {
        let vol = this.settings.beepVolume;
        let freq = this.settings.beepFreq; 
        let duration = this.settings.beepDuration;
        this.prevBeepTime = new Date();
        if (!globalAudio) {
          var AudioContext = window.AudioContext || window.webkitAudioContext;  // find the class
          globalAudio=new AudioContext();
        }
        var startTime = globalAudio.currentTime;
        if (globalAudioOffsetTime && (globalAudioOffsetTime>startTime)) {
          startTime = globalAudioOffsetTime + 0.02;
        }
        var endTime = startTime+duration*0.001;
        globalAudioOffsetTime = endTime;
        var beep=globalAudio.createOscillator();
        beep.frequency.value=freq;
        beep.type="sine";
        var u=globalAudio.createGain();
        u.connect(globalAudio.destination);
        u.gain.setValueAtTime(0, startTime);
        u.gain.linearRampToValueAtTime(vol*0.01, startTime+0.05);
        u.gain.linearRampToValueAtTime(0, endTime);      
        beep.connect(u);
        beep.start(startTime);
        beep.stop(endTime);
      };
    }  // END Transit class
    var collapsingMixin = {
      data: {
        visible: false,
      },        
      methods: {
        toggleVisibility: function() {
          this.visible = !(this.visible);
          if (this.visible) {
            this.$nextTick(function() {	 // may need to scroll down so all the stuff we want to see is visible
              this.$el.scrollIntoView();
            });
          }
        }
      },
      computed: {
        collapseButtonClass: function() {
          if (this.visible) return "collapsible active";
          return "collapsible";
        },
        command: function() {
          if (this.visible) return "Close";
          return "Open";
        },
        iconClass: function() {
          if (this.visible) return "fas fa-chevron-up";
          return "fas fa-chevron-down";
        }
      },  // END computed collection
    };
    var helpPageVue = new Vue({
      mixins: [collapsingMixin],
      el: '#helppage',
      data: {},
      mounted () {
        if (!(this.wasUserHelpSeen())) {
          this.visible = true;
          Vue.nextTick(function() {
            document.getElementById('helppage').scrollIntoView();
          });
        }
      }, 
      methods: {
        saveUserHelpSeen:function() {
          setStorageString("helpseen", JSON.stringify(true));
        },
        wasUserHelpSeen:function() {
          return getStorageData("helpseen"); // will return true (if true was stored) or null (which is false-y)
        },
      },
      watch: {
        visible() {
          this.saveUserHelpSeen();
        }
      }
    });
    var timeDisplayVue = new Vue({
      mixins: [collapsingMixin],
      el: '#timeapp',
      data: {
        nowTime: null,
      },
      computed: {
        timeString: function() {
          if (!this.nowTime) { return ''; }
          var hour = this.nowTime.getHours();
          var ampm = 'am';
          if (hour >= 12) {
            ampm = 'pm';
            if (hour > 12) {
              hour = hour - 12;
            }
          }
          else if (hour == 0) {
            hour = 12;
          }
          var minute =  this.nowTime.getMinutes();
          minute = ('0'+minute).slice(-2);
          var second = this.nowTime.getSeconds();
          second = ('0'+second).slice(-2);
          return `${hour}:${minute}:${second} ${ampm}`;
        },  // END timeString
      },  // END computed collection
      mounted() {
        setInterval(() => { tickTime() }, 333);
      },
    });      
    var transitWatchVue = new Vue({
      data: {
        nowTime: null,
        minBeepRepeatInterval: 1,
        transits: [],
      },
      el: '#app',
      beforeMount() {
        this.retrieveSettings();
      },
      mounted () {
        this.fetchAndProcessData();
        this.fetchAlerts();
        this.startRepeatedFetching();
      },
      methods: {
        /* code to handle drag and drop for re-ordering of items */
        drag(ev) {
          ev.dataTransfer.setData("text", ev.target.id);
        },
        allowDrop:function(ev) {
          ev.preventDefault();
        },
        drop:function(ev) {
          ev.preventDefault();
          var fromIndex = this.transitIndexForID(ev.dataTransfer.getData("text"));
          var toIndex = this.transitIndexForID(ev.target.id);
          this.$data.transits.swap(toIndex, fromIndex);
        },
        deleteTransit:function(event) {
          let sender = event.target;
          let item = this.transitForWidget(sender);
          if (!item) return;
          let prompt = "Remove '" + item.settings.nickname + "'?";
          let response = confirm(prompt);
          if (response) {
            let index = this.transitIndexForID(sender.id);
            this.$data.transits.splice(index, 1);
          }
        },
        toggleShowingSettings:function(event) { 
          let item = this.transitForWidget(event.target);
          if (!item) return;
          item.showSettings = !item.showSettings;
          if (item.showSettings) {
            item.nextBusWidthClass = "col-8";
          }
          else {
            item.nextBusWidthClass = "col-11";
          }
        },
        toggleTransit:function(sender) {
          let item = this.transitForWidget(sender.target);
          if (item)    item.showDetail = !item.showDetail;
        },
        showFullAlert:function(sender) {
          let item = this.transitForWidget(sender.target);
          if (item)    item.showFullAlert = true;
        },
        /* Yes, I know, I know! 
           It would be more elegant to keep a dictionary of the transits with ID as key, of course.
           Famously, searching a list is O(n) whereas hash lookup is typically O(1). And dictionary 
           lookup is one line of code. 
           However, to keep such a dictionary in synch with the transits in our list would be more code
           than this one little function; and we will never have such a big list that the algorithmic complexity 
           matters for this. */
        transitIndexForID:function(id) {
          if (id.search('_') > 0) {
            let fields = id.split('_');
            id = fields[0];
          }
          var i;
          for (i = 0; i < this.$data.transits.length; ++i) {
            var item = this.$data.transits[i];
            if (item.settings.elmID == id) {
              return i;
            }
          }
          return -1;
        },
        transitForID:function(id) {
          let index = this.transitIndexForID(id);
          if (index >= 0) {
            return this.$data.transits[index];
          }
          else {
            return null;
          }
        },
        retrieveSettings: function() {
          let savedBusses = getStorageData("bus");
          if (savedBusses) {
            for (i = 0; i < savedBusses.length; ++i) {
              if (savedBusses[i]) {
                let item = new Transit(savedBusses[i]);
                item.validateTransitSettings(this);
                this.$data.transits.push(item);
              }
            }
          }
        },
        /* For this to work, the widget's id MUST begin with the transit's elmID + '_'.  */
        transitForWidget:function(widget) {
          return this.transitForID(widget.id);
        },
        /* One can enter color-changing times that violate the constraints by typing
             in numbers. Apply the constraints when leaving the field. (NOT while IN the field,
             because say the min is 10; how do you type '15'? */
        applyConstraints:function(event) {
          let item = this.transitForWidget(event.target);
          console.log(item);
          if (!item) return;  // This would be a WTF situation. But, being defensive there...
          item.applyAlertTimeConstraints();
        },
        uniqueTransitID:function() {
          var counter = Math.floor(Math.random() * 500);
          var newID;
          var matches;
          while (true) {
            ++counter;
            newID = "tr" + counter;
            matches = (item) => item.settings.elmID == newID;
            if (!this.$data.transits.some(matches)) {
              return newID;
            }
          }
        },
        addStop:function(nickname, route, direction, directionName, stop, stopName ) {
          if (!nickname) {
            nickname = route + " " + directionName;
          }
          var settings = {};
          settings.nickname = nickname;
          settings.direction = directionName;
          settings.direction_id = direction;  // this is a number (0 or 1) 
          settings.route = route;
          settings.transitType = globalTransitTypeLookup[settings.route];
          settings.stop = stop;   
          settings.stopName = stopName
          settings.ignoreImmediateBusses = true;
          settings.ignoreEarlyBusses = false;
          settings.earlyTime = "08:30";
          settings.immediateThreshold = 1;
          settings.redMinutes = 5;
          settings.yellowMinutes = 10;
          settings.greenMinutes = 15;
          settings.beepVolume = 100;
          settings.beepFreq = 220;
          settings.beepDuration = 300;
          settings.minBeepTime = "07:00";
          settings.maxBeepTime = "09:00";
          settings.repeatInterval = 5;
          settings.elmID = this.uniqueTransitID();
          var transit = new Transit(settings);
          this.$data.transits.push(transit);
          this.fetchAndProcessData();
          this.fetchAlerts();
        },
        fetchAndProcessData:function() {
          var i;
          for (i = 0; i < this.$data.transits.length; i = i+1) {
            this.$data.transits[i].fetchAndProcess();
          }
        },
        makeMeFetch:function() {
          let theVue = this;
          return function() {
            theVue.fetchAndProcessData();
          }
        },
        makeMeFetchAlerts: function() {
          let theVue = this;
          return function() {
            theVue.fetchAlerts();
          }
        },			  
        startRepeatedFetching: function() {
          setInterval(this.makeMeFetch(), 9999);
          setInterval(this.makeMeFetchAlerts(), 1000*60*20); // update alerts every 20 min
        },
        digestAlert: function(response, indices) {
          let data = response.data.data;
          var i;
          for (i = 0; i < indices.length; ++i) {
            this.$data.transits[indices[i]].digestAlert(data);
          }
        },
        fetchAlerts: function() {
          var i;
          var indicesForRoute = {};
          for (i = 0; i < this.$data.transits.length; ++i) {
            let transit = this.$data.transits[i];
            let route = transit.settings.route;
            if (indicesForRoute[route]) {
              indicesForRoute[route].push(i);
            }
            else {
              indicesForRoute[route] = [i];
            }
          } // END for each transit
          // Now we know what routes we're interested in. 
          let routeList = Object.keys(indicesForRoute);
          let myHeaders = getMBTAHeaders();
          for (i = 0; i < routeList.length; ++i) {
            let route = routeList[i];
            let url = "https://api-v3.mbta.com//alerts?filter[route]=" + route;
            let aPromise = axios.get(url, { headers: myHeaders });
            aPromise.then(response => this.digestAlert(response, indicesForRoute[route]));
          }
        },
      },   // END methods
      computed: {
        displaySettingsTrigger() {
          return JSON.stringify(
              this.$data.transits.map(
                  tr => [tr.settings.ignoreImmediateBusses, tr.settings.immediateThreshold]));
        },
        allSettings() {
          return JSON.stringify(
            this.$data.transits.map(
                  tr => tr.settings));
        },
        beepSettingsTrigger() {
          return JSON.stringify(
            this.$data.transits.map(tr => tr.settings.repeatInterval));
          }
      },
      watch: {
        nowTime() {
          var i;
          for (i = 0; i < this.$data.transits.length; i=i+1) {
            this.$data.transits[i].tickTime(this.$data.nowTime);
          }   // END for
        },
        displaySettingsTrigger() { 
          tickTime();
        },
        allSettings() {
          setStorageString("bus", this.allSettings);
        },
        /* The one setting regarding beeps that we need to watch, so as to meddle with anything when it changes,
         is the repeat interval. (Don't need to watch the others because a new beep object is created at each beep.)
         Cancel any currently-running beep trains, so that 
         the next time tickTime calls setUpBeeps, any transit that should currently beep will have a
         new beep train timer set up with the appropriate start time. 
         Also-- this is not the most elegant way to do validation; look at using a library to do validation
         in a general way? See https://vuejs.org/v2/cookbook/form-validation.html#Alternative-Patterns
         for pointers. */
        beepSettingsTrigger() {
          var i;
          for (i = 0; i < this.$data.transits.length; ++i) {
            if (this.$data.transits[i].settings.repeatInterval < this.$data.minBeepRepeatInterval) {
              this.$data.transits[i].settings.repeatInterval = this.$data.minBeepRepeatInterval;
            }
            if (this.$data.transits[i].beepTimerId) {
              clearInterval(this.$data.transits[i].beepTimerId);
              this.$data.transits[i].beepTimerId = null;
            }
          }
        } 
      }
    });
    var stopPickerVue = new Vue({
      mixins: [collapsingMixin],
      el: "#stoppicker",
      data: {
        route: "",
        directions: [ ],
        pickedDirection: "",  // either the empty string, if no direction picked, or number (0 or 1)
        address: "",
        latitude: 42.356334,  // defaults to Park Street Station
        longitude: -71.062365,
        radius: 2,  // approximately in miles (see MBTA documentation)
        results: '',
        nostop: '',
        stops: [],
        pickedStop: "",
        nickname: "",
        routes: [  ],
        googleMap: null,
      },
      mounted () {
        this.fetchRouteNames();
        if (!(transitWatchVue.transits.length)) {
          this.visible = true;
        }
      },
      computed: {
        addStopSeen: function() {
          return (this.isDirectionPicked && this.pickedStop);
        },
        addStopStyle: function() {
          if (this.addStopSeen) {
            return "pulsing";
          }
          return "";
        },
        addStopDisabledReason: function() {
          if (!this.route) {
            return "You must specify which bus, train, or boat you want to catch first, though."
          }
          if (!this.isDirectionPicked) {
            return "You must pick the direction you want to travel in first, though."
          }
          if (!this.pickedStop) {
            return "You must pick which stop to try to catch it at first, though."
          }
          return "";
        },
        selectedTransitType: function() {
          if (this.route) {
            return globalTransitTypeLookup[this.route];
          }
          else {
            return "bus, train, or boat";
          }
        },
        addStopTooltip: function() {
          var text = "Add the selected " + this.selectedTransitType + " to your list of transit options to watch.";
          if (!this.addStopSeen) {
            text = text + " " + this.addStopDisabledReason;
          }
          return text;
        },
        isDirectionPicked: function() {
          return (!(this.pickedDirection === "")); // === is strict equality: same type and value. 
                                               // Otherwise the nothing-picked condition would match direction 0.
        },
      },
      watch: {
        route: function (val) {
          this.lookUpDirections();
        },
        pickedDirection: function(val) {
          this.lookUpStops();
        },
        longitude: function(val) {
          this.updateMapIfNeeded();
          this.lookUpStops();
        },
        latitude: function(val) {
          this.updateMapIfNeeded();
          this.lookUpStops();
        },
        radius: function(val) {
          this.lookUpStops();
        },
        visible: function(val) {
          if (this.visible) {
            this.$nextTick(() => {
              document.getElementById('address').focus();
              this.loadMapIfNeeded();
            });
          }
        },
      },
      methods: {
        detectEnter: function(event) {
          if (event.key == "Enter") {
            event.srcElement.nextElementSibling.click();
          }
        },
        blurOnDetectEnter: function(event) {
          if (event.key == "Enter") {
            event.srcElement.blur();
          }
        },
        digestRouteNames: function(response) {
          let data = response.data.data;
          this.$data.routes = [];
          var i;
          for (i = 0; i < data.length; ++i) {
            var type = data[i].attributes.description;
            type = type.toLowerCase();       
            if (type.includes("bus")) {
              type = "bus";
            }
            else if (type.includes("transit") || type.includes("rail")) {
              type = "train";
            }
            let route = data[i];
            globalTransitTypeLookup[route.id] = type;
            this.$data.routes.push(route.id);
          }
        },
        fetchRouteNames: function() {
          let url = "https://api-v3.mbta.com/routes";
          let aPromise = axios.get(url, { headers: getMBTAHeaders() } );
          aPromise.then(response => this.digestRouteNames(response));
        },
        makeMeUpdateCoordinates: function(map) {
          let theVue = this;
          return function() {
            theVue.$data.latitude = map.center.lat();
            theVue.$data.longitude = map.center.lng();
          }
        },
        loadMapIfNeeded: function() {
          if (!this.$data.googleMap) {  // global
            var boston = new google.maps.LatLng(this.latitude,this.longitude);
            this.$data.googleMap = new google.maps.Map(
              document.getElementById('map'), {center: boston, zoom: 17});
            this.$data.googleMap.addListener('center_changed', this.makeMeUpdateCoordinates(this.$data.googleMap));
          }
        },
        updateMapIfNeeded: function() {
          this.loadMapIfNeeded();
          if (this.$data.googleMap.getCenter().lat() != this.latitude 
              || this.$data.googleMap.getCenter().lng() != this.longitude) {
            this.$data.googleMap.setCenter({lat: parseFloat(this.latitude), lng: parseFloat(this.longitude)});
          }
        },
        makePlaceQueryResultHandler: function() {
          let theVue = this;
          return function(results, status) {
            if (status === google.maps.places.PlacesServiceStatus.OK) {
              var location = results[0].geometry.location;
              if (location) {
                theVue.$data.latitude = location.lat();
                theVue.$data.longitude = location.lng();
              }
              else {
                theVue.$data.latitude = "";
                theVue.$data.longitude = "";
              }  
              theVue.$data.googleMap.setCenter(results[0].geometry.location);
              Vue.nextTick(function () {
                // do when DOM updated: make useful stuff relevatnt to address search on-screen
                document.getElementById('map').scrollIntoView();
                document.getElementById('stop_options').scrollIntoView();
              });            
            }
          };
        },
        lookUpAddress: function() {
          if (!this.address) {
            return;
          }
          this.loadMapIfNeeded();
          var request = {
            query: this.address,
            fields: ['name', 'geometry'],
          };
          var service = new google.maps.places.PlacesService(this.$data.googleMap);
          service.findPlaceFromQuery(request, this.makePlaceQueryResultHandler());
        },
        lookUpStops: function() {
          this.stops = [];
          this.nostop = '';
          this.pickedStop = "";
          if (!(this.latitude && this.longitude)) {
            return;
          }
          if (!this.route) {
            return;
          }
          if (!this.isDirectionPicked) return;
          let url = "https://api-v3.mbta.com/stops?" +
                 "filter[latitude]=" + this.latitude + 
                 "&filter[longitude]=" + this.longitude + 
                 "&filter[radius]=" + 0.02*this.radius + 
                 "&filter[route]=" + this.route +
                 "&filter[direction_id]=" + this.pickedDirection + 
                 "&sort=distance" ;
          console.log(url);
          axios.get(url, { headers: getMBTAHeaders() })
              .then(response => this.displayStops(response) );
        },
        lookUpDirections: function() {
          this.directions = [];
          this.pickedDirection = "";
          this.nostop = '';
          this.stops = [];
          this.pickedStop = "";
          if (!(this.route)) {
            return;
          }
          if (!(globalTransitTypeLookup[this.route])) { // user typed something invalid or partial
            return;
          }
          let url = "https://api-v3.mbta.com/routes/" + this.route;
          axios.get(url, { headers: getMBTAHeaders() } )
               .then(response => this.displayRouteInfo(response));
        },
        displayRouteInfo: function(response) {
          this.$data.results = pretty(response.data.data.attributes);
          var data = response.data.data;
          this.$data.directions = [];
          var i;
          for (i = 0; i < data.attributes.direction_names.length; i = i+1) {
            var s = data.attributes.direction_names[i] + " to " +
                   data.attributes.direction_destinations[i];
            var label = "direction_" + i;
            item = { name: s, id: i, label: label };
            this.$data.directions.push(item);
          }
          this.$nextTick(function() { // make all buttons scroll into view when they're created
            this.$el.scrollIntoView();
          });
        },
        displayStops: function(response) {
          this.$data.stops = [];
          this.$data.stopNameLookup = {}
          for (i = 0; i < 3 && i < response.data.data.length; i=i+1) {
            var stopData = response.data.data[i];
            var stopLabel = "stop_" + stopData.id;
            var newStop = { 'name': stopData.attributes.name, 'id': stopData.id, 'label':stopLabel };
            this.$data.stopNameLookup[stopData.id] = stopData.attributes.name;
            this.$data.stops.push(newStop);
            this.$data.nostop = '';
          }
          if (!this.$data.stops.length) {
            this.$data.nostop = 'No stops for ' + this.$data.route + ' near the currently selected location.';
          }
          this.$data.results = pretty(response.data.data);
          this.$nextTick(function() { // make all buttons scroll into view when they're created
            this.$el.scrollIntoView();
          });
        },   // END displayStops()
        addStop:function() {
          transitWatchVue.addStop(this.$data.nickname, this.$data.route, this.$data.pickedDirection, 
             this.$data.directions[this.$data.pickedDirection].name, this.$data.pickedStop, 
             this.$data.stopNameLookup[this.$data.pickedStop]);
          this.$data.nickname = "";
          this.$data.visible = false;
        }
      } // END methods
    });
    /* Analog clocks */
    class AnalogClock {
      constructor(id) {
        this.elmID = id;
        this.clock = document.getElementById(this.elmID);
        this.radius = this.clock.height / 2;
        var ctx = this.clock.getContext("2d");
        ctx.translate(this.radius, this.radius);
        this.radius = this.radius * 0.90;

        this.drawClock();
      };
      drawAnalogTime() {
        var ctx = this.clock.getContext("2d");
        ctx.fillStyle = '#333';
        var now = new Date();
        var hour = now.getHours();
        var minute = now.getMinutes();
        //hour
        hour = hour%12;
        hour = (hour*Math.PI/6)+(minute*Math.PI/(6*60));
        this.drawHand(hour, this.radius*0.5, this.radius*0.07);
        //minute
        minute = (minute*Math.PI/30);
        this.drawHand(minute, this.radius*0.8, this.radius*0.07);
      };
      drawClock() {
        var ctx = this.clock.getContext("2d");
        // white clock face...
        ctx.arc(0, 0, this.radius, 0 , 2 * Math.PI);
        ctx.strokeStyle="black";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.fill();
        this.drawAnalogTime();
        this.drawClockNumbers();
      };
      drawHand(pos, length, width) {
        var ctx = this.clock.getContext("2d");
        ctx.strokeStyle="black";
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.rotate(pos);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -length);
        ctx.stroke();
        ctx.rotate(-pos);
        ctx.beginPath();
      };
      drawClockNumbers() {
        var ctx = this.clock.getContext("2d");
        var ang;
        var num;
        ctx.fillStyle = '#333';
        ctx.font = this.radius * 0.2 + "px arial";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        for (num = 1; num <= 12; num++) {
          ang = num * Math.PI / 6;
          ctx.rotate(ang);
          ctx.translate(0, -this.radius * 0.85);
          ctx.rotate(-ang);
          ctx.fillText(num.toString(), 0, 0);
          ctx.rotate(ang);
          ctx.translate(0, this.radius * 0.85);
          ctx.rotate(-ang);
        }
      };
      static makeDrawingFunction(clock) {
        return function() {
          clock.drawClock();
        }
      };
      startGoing() {
        setInterval(this.constructor.makeDrawingFunction(this), 1000);
      };
    }
    globalClock = new AnalogClock("clock");
    globalClock.startGoing();
