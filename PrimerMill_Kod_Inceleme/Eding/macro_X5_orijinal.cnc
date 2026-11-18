;Welcome X5

Sub user_1
	msg "Zero Z (G92) using toolsetter"
	m5
	m9
	g53 g90 g0 z[#5163] a[#5224]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	m54p4
	g4p0.5
	m55p4
	g53 g90 g0 z[#4003]

	if[[#5380 == 0] and [#5397 == 0]]
		m56p61
		if[#5399 == 0]
			errmsg "error probe damage"
		endif
	endif

	f50
	g53 g90 g38.2 z[#4004]

	if[#5067 == 0]
		warnmsg "warn there is no tool on the spindle"
	endif

	g90 g0 z[#5063]
	G92 z[#4002]
	g53 g90 g0 z[#5163]
Endsub

;Tool length measurement example
Sub user_2
	msg "sub user_2"
Endsub

Sub user_3 ;Example of dlgmsg
	dlgmsg "whitethcnc" "change tool height" 4000 "change tool slow height" 4001 "probe heigh" 4002 "probe slow heigh" 4003 "probe down limit heigh" 4004 "Tool wear length" 4005 "Tool detect" 4006
	if [#5398 == 1]
		msg "OK #4000="#4000 "#4001="#4001 "#4002="#4002 "#4003="#4003 "#4004="#4004 "#4005="#4005 "#4006="#4006
	else
		msg "CANCEL #4000="#4000 "#4001="#4001 "#4002="#4002 "#4003="#4003 "#4004="#4004 "#4005="#4005 "#4006="#4006
	endif
Endsub

Sub user_4
	msg "sub user_4"
	m54p2
Endsub

Sub user_5
	msg "sub user_5"
	m55p2
Endsub

Sub user_6
	msg "sub user_6"
	warnmsg "warn step 1 move to x_up press ctrl-g"
	#30 = #5071
	warnmsg "warn step 2 move to x_down press ctrl-g"
	#31 = #5071
	warnmsg "warn step 3 move to y_up press ctrl-g"
	#32 = #5072
	warnmsg "warn step 4 move to y_down press ctrl-g"
	#33 = #5072

	#5211=0
	#5212=0
	#5213=0
	#5214=0
	#5215=0
	#5216=0

	g53g0z0
	g53g0x[[#30+#31]/2]y[[#32+#33]/2]
	g10 l20 p1 x0 y0 z0 a0

	msg "partition center complete"
Endsub

Sub user_7
	msg "sub user_7"
Endsub

Sub user_8
	msg "sub user_8"
Endsub

Sub user_9
	msg "sub user_9"
Endsub

Sub user_10
	msg "sub user_10"
Endsub

Sub user_11
	msg "sub user_11"
Endsub

Sub user_12
	msg "sub user_12"
Endsub

;Homing per axis
Sub home_x
	home x
Endsub

Sub home_y
	home y
Endsub

Sub home_z
	home z
Endsub

Sub home_a
	home a
Endsub

Sub home_b
	home b
Endsub

Sub home_c
	home c
Endsub

sub home_all
	gosub home_z
	gosub home_x
	gosub home_y
	gosub home_a
        gosub home_b

        g0 g53 x-4.0 y-4.0 z-4.0 a4.0
	g4 p0.2

	m81
	g4 p0.2
	m80
	g4p2.0

	gosub home_b

        msg "Home complete"
	g30
        g64 p0.1 d0.001
endsub

sub check_pressure
	m56p1

	if[#5399 == 0]
		warnmsg "warn air pressure low waiting..."
	endif

	while[#5399 == 0]
		g4p0.2
		m56p1
	endwhile
endsub

sub change_tool
	;Switch off guard for tool change area collision
	TCAGuard off

	;Check ZHeight comp and switch off when on, remember the state in #5019
	;#5151 indicates that ZHeight comp is on
	#5019 = #5151
	if [#5019 == 1]
		ZHC off
	endif

	;Switch off spindle
	m5
	m9

	;Use #5015 to indicate succesfull toolchange
	#5015 = 0 ; Tool change not performed

	; check tool in spindle and exit sub
	if [ [#5011] <> [#5008] ]
		if [[#5011] > 6 ]
			errmsg "error please select a tool from 1 to 6."
		else
			;Drop current tool
			g53 g90 g0 z[#5163]
			g53 g90 g0 a[#5224] b[#5225]
			g53 g90 g0 x[#5221-72.25]


			if [[#5008] == 0]
				GoSub DropTool0
			endif

			if [[#5008] == 1]
				GoSub DropTool1
			endif

			if [[#5008] == 2]
				GoSub DropTool2
			endif

			if [[#5008] == 3]
				GoSub DropTool3
			endif

			if [[#5008] == 4]
				GoSub DropTool4
			endif

			if [[#5008] == 5]
				GoSub DropTool5
			endif

			if [[#5008] == 6]
				GoSub DropTool6
			endif

			;Pick new tool
			if [[#5011] == 0]
				GoSub PickTool0
			endif

			if [[#5011] == 1]
				GoSub PickTool1
			endif

			if [[#5011] == 2]
				GoSub PickTool2
			endif

			if [[#5011] == 3]
				GoSub PickTool3
			endif

			if [[#5011] == 4]
				GoSub PickTool4
			endif

			if [[#5011] == 5]
				GoSub PickTool5
			endif

			if [[#5011] == 6]
				GoSub PickTool6
			endif
		endif
	else
		msg "Tool already in spindle"
		#5015 = 1 ;indicate tool change performed
	endif

	if [[#5015] == 1]
		msg "Tool "#5008" Replaced by tool "#5011" G43 switched on"
		m6t[#5011]

		if [#5011 <> 0]
			;G43  ;we use tool-length compensation.
			goSub user_1
			;else
			;G49  ;tool length compensation off for tool 0.
		endif
	else
		errmsg "error tool change failed"
	endif

	;Set default motion type to G0
	g0

	;Switch on guard for tool change area collision
	TCAGuard on

	;Check if ZHeight comp was on before and switch ON again if it was.
	if [#5019 == 1]
		ZHC on
	endif
EndSub

sub is_empty_tool
	m5
	m9
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	m54p4
	g4p0.5
	m55p4
	g53 g90 g0 z[#4003]
	f50
	g53 g90 g38.2 z[#4004]

	if[[#5067] == 1]
		g53 g90 g0 z[#5163]
		errmsg "error there is tool on the spindle"
	endif

	g53 g90 g0 z[#5163]

	msg "There is no tool on the spindle"
endsub

;Drop tool subroutines
Sub DropTool0
	;Tool 0 is nothing, we could open the tool
	;magazine here if needed for the following PickTool
	if [[#5380 == 0] and [#5397 == 0]]
		gosub is_empty_tool
		gosub check_pressure
	endif

	m54p2
	g4p1
	g53 g90 g0 z[#5163]
	msg "Dropping tool 0"
endsub

Sub DropTool1
	;T1 manuel kalibre edildi (2026-10-20)
	g53 g90 g0 z[#5163]
	g53 g90 g0 a23.2 b-1
	g53 g90 g0 x-125.557 y-88.966
	m54p4
	g4p0.5
	m55p4

	;T1: alma yuksekligi -45 oldugu icin birakma -44
	g53 g90 g0 z-44

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	m54p2
	g4p1
	g53 g90 g0 z[#5163]
	g53 g90 g0 a[#5224] b[#5225]
	msg "Dropping tool 1"

	if[#4006 <> 0]
		m55p2

		if [[#5380 == 0] and [#5397 == 0]]
			gosub is_empty_tool
		endif

		m54p2
	endif
endsub

Sub DropTool2
	g53g0x[#5221-72.25]y[#5222-27]
	m54p4
	g4p0.5
	m55p4

	g53 g90 g0 z[#4000+1]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	m54p2
	g4p1
	g53 g90 g0 z[#5163]
	msg "Dropping tool 2"

	if[#4006 <> 0]
		m55p2

		if [[#5380 == 0] and [#5397 == 0]]
			gosub is_empty_tool
		endif

		m54p2
	endif
endsub

Sub DropTool3
	g53g0x[#5221-72.25]y[#5222-15]
	m54p4
	g4p0.5
	m55p4

	g53 g90 g0 z[#4000+1]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	m54p2
	g4p1
	g53 g90 g0 z[#5163]
	msg "Dropping tool 3"

	if[#4006 <> 0]
		m55p2

		if [[#5380 == 0] and [#5397 == 0]]
			gosub is_empty_tool
		endif

		m54p2
	endif
endsub

Sub DropTool4
	g53g0x[#5221-72.25]y[#5222+15]
	m54p4
	g4p0.5
	m55p4

	g53 g90 g0 z[#4000+1]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	m54p2
	g4p1
	g53 g90 g0 z[#5163]
	msg "Dropping tool 4"

	if[#4006 <> 0]
		m55p2

		if [[#5380 == 0] and [#5397 == 0]]
			gosub is_empty_tool
		endif

		m54p2
	endif
endsub

Sub DropTool5
	g53g0x[#5221-72.25]y[#5222+27]
	m54p4
	g4p0.5
	m55p4

	g53 g90 g0 z[#4000+1]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	m54p2
	g4p1
	g53 g90 g0 z[#5163]
	msg "Dropping tool 5"

	if[#4006 <> 0]
		m55p2

		if [[#5380 == 0] and [#5397 == 0]]
			gosub is_empty_tool
		endif

		m54p2
	endif
endsub

Sub DropTool6
	g53g0x[#5221-72.25]y[#5222+39]
	m54p4
	g4p0.5
	m55p4

	g53 g90 g0 z[#4000+1]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	m54p2
	g4p1
	g53 g90 g0 z[#5163]
	msg "Dropping tool 6"

	if[#4006 <> 0]
		m55p2

		if [[#5380 == 0] and [#5397 == 0]]
			gosub is_empty_tool
		endif

		m54p2
	endif
endsub

;Pick tool subroutines
Sub PickTool0
	msg "Picking tool 0"
	;Tool 0 is nothing, so we just close the
	;tool magazine here if needed.
	m55p2
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	#5015 = 1 ; toolchange succes
endsub

Sub PickTool1
	msg "Picking tool 1"
	;T1 manuel kalibre edildi (2026-10-20)
	g53 g90 g0 z[#5163]
	g53 g90 g0 a23.2 b-1
	g53 g90 g0 x-125.557 y-88.966
	m54p4
	g4p0.5
	m55p4

	g53g0z[#4001]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	;T1: pensi Z -45'te kapat (kol esnemesin)
	g53g1z-45f800
	m55p2
	g4p1
	g53 g90 g0 z[#5163]
	g53 g90 g0 a[#5224] b[#5225]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	#5015 = 1 ; toolchange succes
endsub

Sub PickTool2
	msg "Picking tool 2"
	g53g0x[#5221-72.25]y[#5222-27]
	m54p4
	g4p0.5
	m55p4

	g53g0z[#4001]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	g53g1z[#4000]f800
	m55p2
	g4p1
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	#5015 = 1 ; Tool change succes
endsub

Sub PickTool3
	msg "Picking tool 3"
	g53g0x[#5221-72.25]y[#5222-15]
	m54p4
	g4p0.5
	m55p4

	g53g0z[#4001]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	g53g1z[#4000]f800
	m55p2
	g4p1
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	#5015 = 1 ; Tool change succes
endsub

Sub PickTool4
	msg "Picking tool 4"
	g53g0x[#5221-72.25]y[#5222+15]
	m54p4
	g4p0.5
	m55p4

	g53g0z[#4001]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	g53g1z[#4000]f800
	m55p2
	g4p1
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	#5015 = 1 ; Tool change succes
endsub

Sub PickTool5
	msg "Picking tool 5"
	g53g0x[#5221-72.25]y[#5222+27]
	m54p4
	g4p0.5
	m55p4

	g53g0z[#4001]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	g53g1z[#4000]f800
	m55p2
	g4p1
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	#5015 = 1 ; Tool change succes
endsub

Sub PickTool6
	msg "Picking tool 6"
	g53g0x[#5221-72.25]y[#5222+39]
	m54p4
	g4p0.5
	m55p4

	g53g0z[#4001]

	if [[#5380 == 0] and [#5397 == 0]]
		gosub check_pressure
	endif

	g53g1z[#4000]f800
	m55p2
	g4p1
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5221-72.25] y[#5222]
	#5015 = 1 ; Tool change succes
endsub

sub m100
	if [[#5380 == 0] and [#5397 == 0]]
		m5
		m9
		g53 g90 g0 z[#5163]
		g53 g90 g0 x[#5221-72.25] y[#5222]
		m54p4
		g4p0.5
		m55p4
		g53 g90 g0 z[#4003]

		m56p61
		if[#5399 == 0]
			errmsg "error probe damage"
		endif

		f50
		g53 g90 g38.2 z[#4004]

		if[#5067 == 0]
			errmsg "error there is no tool on the spindle"
		endif

		g90 g0 z[#5063]

		if[[#4002-#5063] > #4005]
			warnmsg "warn tool wear " [#4002-#5063] "mm exceed limit"
		else
			msg "Tool wear " [#4002-#5063] "mm"
		endif

		g53 g90 g0 z[#5163]
	endif
endsub

sub m101
	msg "m101"
endsub

sub ClearPos
	g53 g90 g0 z[#5163]
	g53 g90 g0 x[#5161]
	if[#5004 <> 0]
		g54 g90 g0 a0
	else
		g54 g90 g0 a-25
	endif
endsub

sub z_safe
	g53 g90 g0 z[#5163]
endsub

sub azxy_safe
	g53 g90 g0 z[#5163] a[#5224]
	g53 g90 g0 x[#5221-72.25] y[#5222]
endsub

sub check_empty_tool
	if[#5008 <> 0]
		errmsg "error the spindle must not be clampe tool before the program is run."
	endif
endsub
