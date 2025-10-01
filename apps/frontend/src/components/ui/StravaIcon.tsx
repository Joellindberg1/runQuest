import React from 'react';

interface StravaIconProps {
  size?: number;
  className?: string;
}

export const StravaIcon: React.FC<StravaIconProps> = ({ size = 16, className = "" }) => (
  <div 
    className={className}
    style={{
      position: 'relative',
      width: `${size}px`,
      height: `${size}px`,
      background: '#fc4c02',
      borderRadius: '50%', // Circular shape
      display: 'inline-block'
    }}
  >
    <div 
      style={{
        transform: 'scaleX(0.5)',
        width: '87%',
        aspectRatio: '1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: '1.4%',
        position: 'relative'
      }}
    >
      <div 
        style={{
          position: 'absolute',
          content: '""',
          aspectRatio: '1',
          transform: 'rotate(45deg)',
          marginTop: '26%',
          width: '64%',
          background: 'linear-gradient(to right bottom, white, white 50%, transparent 50%, transparent)'
        }}
      />
      <div 
        style={{
          position: 'absolute',
          content: '""',
          aspectRatio: '1',
          transform: 'rotate(45deg)',
          marginTop: '26%',
          width: '26%',
          background: 'linear-gradient(to right bottom, #fc4c02, #fc4c02 50%, transparent 50%, transparent)'
        }}
      />
    </div>
    <div 
      style={{
        transform: 'scaleX(0.54)',
        width: '100%',
        aspectRatio: '1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: '8.4%',
        marginTop: '-82%',
        position: 'relative'
      }}
    >
      <div 
        style={{
          content: '""',
          position: 'absolute',
          aspectRatio: '1',
          transform: 'rotate(45deg)',
          width: '39%',
          background: 'linear-gradient(to left top, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.6) 50%, transparent 50%, transparent)'
        }}
      />
      <div 
        style={{
          content: '""',
          position: 'absolute',
          aspectRatio: '1',
          transform: 'rotate(45deg)',
          width: '15%',
          background: 'linear-gradient(to left top, #fc4c02, #fc4c02 50%, transparent 50%, transparent)'
        }}
      />
    </div>
  </div>
);