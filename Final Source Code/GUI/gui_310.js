const gpsd = require('node-gpsd');
var arDrone = require('ar-drone');
const Gpio = require('pigpio').Gpio;

var droneClient = arDrone.createClient();
droneClient.disableEmergency();
droneClient.config('general:navdata_demo', 'FALSE'); // get back all data the copter can send
droneClient.config('general:navdata_options', 777060865); // turn on GPS


var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;


app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});


var daemon = new gpsd.Daemon({
	device: '/dev/ttyACM0'
});
droneClient.disableEmergency();

//droneClient.calibrate(1);
//droneClient.takeoff();


var lead_Lat, lead_Lon, follow_Lat, follow_Lon, theta, heading;
var start = new Date();
var foundbufferStart = new Date();
var calibrated = 0;
var lead_Alt, follow_Alt;

// The number of microseconds it takes sound to travel 1cm at 20 degrees celcius
const MICROSECDONDS_PER_CM = 1e6/34321;

const trigger = new Gpio(23, {mode: Gpio.OUTPUT});
const echo = new Gpio(24, {mode: Gpio.INPUT, alert: true});

trigger.digitalWrite(0); // Make sure trigger is low


function daemonInit() {
	console.log('GPSD Daemon Started');

	const LISTENER = new gpsd.Listener();

	LISTENER.on('TPV', function(tpv) {
		gpsData = tpv;
		//console.log("Raspberry Pi Latitude: " + gpsData.lat + " Longitude: " + gpsData.lon);
		lead_Lat = gpsData.lat;
		lead_Lon = gpsData.lon;


	});

	droneClient.on('navdata', function(navdata) {
		try{
			//buffer before drone calibrates
			if((new Date() - start > 2000) && calibrated == 0){
				calibrated = 1;
				droneClient.calibrate(0);
			}

			//get latitude and longitude
			follow_Lat = navdata.gps.latFuse;
			follow_Lon = navdata.gps.lonFuse;
      io.on('connection', function(socket){
        socket.on('elevation', function(msg){
          io.emit('elevation', 1);
        });
      });//end
			//get theta
			theta = calcHeading(follow_Lat,follow_Lon,lead_Lat,lead_Lon);

			//get heading
			heading = (navdata.magneto.heading.fusionUnwrapped + 3600) % 360;

			//get distance
			distance = calcDistance(follow_Lat,follow_Lon,lead_Lat,lead_Lon);

			//get altitude
			follow_Alt = navdata.demo.altitudeMeters;

			//altitude diff
			Alt_Diff = lead_Alt - follow_Alt;
			//get elevation
			elevation = navdata.gps.elevation;


			var end = new Date() - start;
			var foundbufferEnd = new Date() - foundbufferStart

			//spinning if statement
			//&& foundbufferEnd > 1000
			if(end > 17000 && foundbufferEnd > 1000){
				if(Math.abs(Alt_Diff) < 1){
					if((heading < theta - 3 || heading > theta + 3 || isNaN(theta) == true)){
						if(heading <= 180){
							if(theta <= heading + 180 && theta > heading){
								droneClient.stop();
								droneClient.clockwise(0.25);
								console.log('spinning right')
							}
							else{
								droneClient.stop();
								droneClient.counterClockwise(0.25);
								console.log('spinning left')
							}
						}
						else{
							if(theta >= heading - 180 && theta < heading){
								droneClient.stop();
								droneClient.counterClockwise(0.25);
								console.log('spinning left')
							}
							else{
								droneClient.stop();
								droneClient.clockwise(0.25);
								console.log('spinning right')
							}
						}
					}else{
						foundbufferStart = new Date();
						droneClient.stop();
						console.log('stopping');
						console.log("\n\n\nTHIS IS FINAL THIS IS IT WERE DOING IT BLAH BLAH \nFINAL Theta: " + theta);
						console.log('FINAL Heading:' + heading + "\n\n\n");
						if(distance > 2){
				 	    droneClient.front(0.1);
				 	    console.log('FLYING FORWARD REMAIN CALM');
	          			}
					}
				}else{
					if(Alt_Diff > 1){
						droneClient.up(0.5);
						console.log('up');
					}else{
						droneClient.down(0.5);
						console.log('down');
					}
				}
			}

		}catch(err){
		console.log(err.message);
		}
	});


	LISTENER.connect(function() {
		console.log('Connected');
		LISTENER.watch();
	});
}

function startSpinning() {
	if(heading < theta - 5 || heading > theta + 5 || isNaN(theta) == true){
		droneClient.stop();
		droneClient.clockwise(0.25);
		//console.log('spinning');
	}else{
		droneClient.stop();
		//console.log('stopping');
		console.log("FINAL Theta: " + theta);
		console.log('FINAL Heading:' + heading);
		process.exit();
	}
}

function myFunc(){
	daemon.start(daemonInit);
}

function calcHeading(fLat,fLon,lLat,lLon){
	//console.log("Calc heading called\n");
	F_Lat_Rad = fLat * 3.1415 / 180;
	F_Lon_Rad = fLon * 3.1415 / 180;

	L_Lat_Rad = lLat * 3.1415 / 180;
	L_Lon_Rad = lLon * 3.1415 / 180;

	theta = Math.atan2( Math.sin(L_Lon_Rad - F_Lon_Rad) * Math.cos(L_Lat_Rad),
				Math.cos(F_Lat_Rad) * Math.sin(L_Lat_Rad) - Math.sin(F_Lat_Rad) *
				Math.cos(L_Lat_Rad) * Math.cos(L_Lon_Rad - F_Lon_Rad) );

	thetaDegrees = ((theta * 180 / 3.1415) + 360) % 360;
	return thetaDegrees;
}

function calcDistance(fLat,fLon,lLat,lLon){
	var earthRadius = 6371000;

	F_Lat_Rad = fLat * 3.1415 / 180;
	L_Lat_Rad = lLat * 3.1415 / 180;

	var latDiff = (fLat - lLat) * 3.1415 / 180;
	var lonDiff = (fLon - lLon) * 3.1415 / 180;

	var haverSine = Math.sin((latDiff/2) * Math.sin(latDiff/2) + Math.cos(L_Lat_Rad) * Math.cos(F_Lat_Rad) * Math.sin(lonDiff/2) * Math.sin(lonDiff/2));

	//c (depends on HaverSine)
	var c = 2 * Math.atan2(Math.sqrt(haverSine), Math.sqrt(1-haverSine));

	//Complete distance formula
	var distance = earthRadius * c;
	return distance;
}

setTimeout(myFunc,1000,'funky');

const watchHCSR04 = () => {
  let startTick;

  echo.on('alert', (level, tick) => {
    if (level == 1) {
      startTick = tick;
    } else {
      const endTick = tick;
      const diff = (endTick >> 0) - (startTick >> 0); // Unsigned 32 bit arithmetic
      lead_Alt = diff / 2 / MICROSECDONDS_PER_CM / 100;
      console.log("Leader Drone Altitude:" + lead_Alt);
    }
  });
};

http.listen(port, function(){
  console.log('listening on *:' + port);
});
watchHCSR04();

// Trigger a distance measurement once per second
setInterval(() => {
  trigger.trigger(10, 1); // Set trigger high for 10 microseconds
}, 1000);

io.on('connection', function(socket){
  socket.on('elevation', function(msg){
    io.emit('elevation', 1);
  });
  socket.on('longitude', function(msg){
    io.emit('longitude', 5);
  });
  socket.on('latitude', function(msg){
    io.emit('latitude', 5);
  });
});
