import React, { useEffect, useState } from 'react';
import {
    FormControl,
    FormLabel,
    FormHelperText,
    Textarea,
    IconButton,
    FormErrorMessage,
    Text
} from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { showSuccessToast } from '../../utils/ToastUtils';
import { setConfig } from '../../slices/ConfigSlice';
import { AiOutlineSave } from 'react-icons/ai';

export const SlackAlertCustomMessageField = (): JSX.Element => {
    const dispatch = useAppDispatch();
    const customMessage: string = (useAppSelector(state => state.config.slack_alert_custom_message) ?? '');
    const [newMessage, setNewMessage] = useState(customMessage);
    const [error, setError] = useState('');
    const hasError: boolean = (error ?? '').length > 0;

    useEffect(() => { setNewMessage(customMessage); }, [customMessage]);

    const saveMessage = (val: string): void => {
        if (val === customMessage) {
            setError('You have not changed the message since your last save!');
            return;
        }

        dispatch(setConfig({ name: 'slack_alert_custom_message', value: val }));
        setError('');
        showSuccessToast({
            id: 'settings',
            duration: 4000,
            description: 'Successfully saved custom alert message!'
        });
    };

    return (
        <FormControl isInvalid={hasError}>
            <FormLabel htmlFor='slack_alert_custom_message'>Custom Alert Message (Optional)</FormLabel>
            <Textarea
                id='slack_alert_custom_message'
                maxWidth="30em"
                rows={3}
                placeholder='e.g. Runbook: https://docs.example.com/imessage-troubleshooting'
                value={newMessage}
                onChange={(e) => {
                    if (hasError) setError('');
                    setNewMessage(e.target.value);
                }}
            />
            <IconButton
                ml={3}
                mt={1}
                verticalAlign='top'
                aria-label='Save custom alert message'
                icon={<AiOutlineSave />}
                onClick={() => saveMessage(newMessage)}
            />
            {!hasError ? (
                <FormHelperText>
                    <Text>
                        This message is appended to alert notifications (no-receive, no-send, activity drop).
                        Use it for documentation links, runbook URLs, or escalation instructions.
                        Supports Slack markdown formatting.
                    </Text>
                </FormHelperText>
            ) : (
                <FormErrorMessage>{error}</FormErrorMessage>
            )}
        </FormControl>
    );
};
