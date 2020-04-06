# bus-alarm
Vue.js-based webpage for conveniently keeping an eye on the MBTA's predictions of when your bus arrives. Or train, or trolley, or boat...

Note: You MUST get your own API keys from the MBTA and from Google to get this code to work. Google "MBTA API key" and 
"Google maps API key" to find out how. You will have to edit mbtakey.js and googkey.js to put in your own keys. 
Fortunately, these API keys are free, at least to get started. (Google will charge you eventually if you have a large number 
of hits, but they give you $200 worth of free hits per month, and you can limit the number of hits allowed on your key to
always be less than that.)

Welcome to the Bus Alarm, a handy tool for helping you keep track of when your Boston-area MBTA bus, trolly, or other mode of transport is expected to be at your nearest stop. Keeping an eye on these predictions is especially helpful if you need to catch an infrequently-running bus. Don't you just hate standing by the side of the road, in the weather, waiting at the bus stop for half an hour or more? Keep a close eye on those predictions, and you can spend up to the last reasonable moment in your warm, dry home or office before scampering to the bus stop (or T stop, or ferry dock...) just in time!

This code demonstrates use of the Vue.js framework in a very object-oriented way, use of axios to consume a RESTful API,
the programmatic use of the Google Maps and Places APIs, use of local storage (instead of cookies), creating sounds using
AudioContext, and other snazzy JavaScript things.

Copyright 2020 Alex Morgan
