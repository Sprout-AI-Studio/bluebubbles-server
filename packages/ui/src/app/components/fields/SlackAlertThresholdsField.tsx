import React, { useState } from 'react';
import {
    FormControl,
    FormLabel,
    FormHelperText,
    Input,
    Stack,
    Text,
    IconButton
} from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { showSuccessToast } from '../../utils/ToastUtils';
import { setConfigBulk } from '../../slices/ConfigSlice';
import { AiOutlineSave } from 'react-icons/ai';

export const SlackAlertThresholdsField = (): JSX.Element => {
    const dispatch = useAppDispatch();
    const noReceiveMinutes: number = (useAppSelector(state => state.config.slack_alert_no_receive_minutes) ?? 10);
    const noSendMinutes: number = (useAppSelector(state => state.config.slack_alert_no_send_minutes) ?? 10);
    const activityDropPercent: number = (useAppSelector(state => state.config.slack_activity_drop_percent) ?? 50);

    const [newNoReceive, setNewNoReceive] = useState(noReceiveMinutes);
    const [newNoSend, setNewNoSend] = useState(noSendMinutes);
    const [newDropPercent, setNewDropPercent] = useState(activityDropPercent);

    const saveThresholds = (): void => {
        dispatch(setConfigBulk([
            { name: 'slack_alert_no_receive_minutes', value: newNoReceive },
            { name: 'slack_alert_no_send_minutes', value: newNoSend },
            { name: 'slack_activity_drop_percent', value: newDropPercent }
        ]));
        showSuccessToast({
            id: 'settings',
            duration: 4000,
            description: 'Successfully saved Slack alert thresholds!'
        });
    };

    return (
        <FormControl>
            <FormLabel>Alert Thresholds</FormLabel>
            <Stack direction='row' align='center' spacing={4} flexWrap='wrap'>
                <Stack direction='column' spacing={1}>
                    <Text fontSize='sm'>No Receive (min)</Text>
                    <Input
                        type='number'
                        size='sm'
                        width='8em'
                        min={1}
                        value={newNoReceive}
                        onChange={(e) => setNewNoReceive(parseInt(e.target.value) || 1)}
                    />
                </Stack>
                <Stack direction='column' spacing={1}>
                    <Text fontSize='sm'>No Send (min)</Text>
                    <Input
                        type='number'
                        size='sm'
                        width='8em'
                        min={1}
                        value={newNoSend}
                        onChange={(e) => setNewNoSend(parseInt(e.target.value) || 1)}
                    />
                </Stack>
                <Stack direction='column' spacing={1}>
                    <Text fontSize='sm'>Activity Drop (%)</Text>
                    <Input
                        type='number'
                        size='sm'
                        width='8em'
                        min={1}
                        max={100}
                        value={newDropPercent}
                        onChange={(e) => setNewDropPercent(parseInt(e.target.value) || 50)}
                    />
                </Stack>
                <IconButton
                    mt={5}
                    aria-label='Save alert thresholds'
                    icon={<AiOutlineSave />}
                    onClick={saveThresholds}
                />
            </Stack>
            <FormHelperText>
                <Text>
                    Configure how long to wait before alerting on missing messages,
                    and the percentage drop in activity that triggers an alert.
                </Text>
            </FormHelperText>
        </FormControl>
    );
};
